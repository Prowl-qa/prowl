// Commands.swift — the stateful driver session. Holds the attached app between
// verbs (so the frontmost window and open menus persist across the JSON-over-
// stdio protocol) and implements the SessionDriver verbs the TypeScript
// MacDriver calls.

import AppKit
import ApplicationServices
import Foundation

final class Session {
    private(set) var app: AXUIElement?
    private(set) var bundleId: String?
    private var runningApp: NSRunningApplication?

    /// How long `quit()` waits for a graceful terminate before escalating to a
    /// forced kill, and then for that kill to take effect. Kept well under the
    /// helper transport's per-request deadline so a stuck quit still returns an
    /// honest result instead of hanging the caller.
    private let terminationTimeout: TimeInterval = 5.0

    private func requireApp() throws -> AXUIElement {
        guard let app else { throw AXFailure("no app attached — send a \"launch\" command first") }
        return app
    }

    private func requireTrusted() throws {
        guard AXIsProcessTrusted() else {
            throw AXFailure(
                "not trusted for Accessibility — grant the hosting terminal/app permission in "
                    + "System Settings → Privacy & Security → Accessibility"
            )
        }
    }

    // MARK: - Lifecycle

    func check() -> [String: Any] {
        ["trusted": AXIsProcessTrusted()]
    }

    func launch(app appRef: String, timeout: TimeInterval) throws -> [String: Any] {
        try requireTrusted()
        let ws = NSWorkspace.shared
        let looksLikePath = appRef.contains("/") || appRef.hasSuffix(".app")

        // Never attach to a dying instance. A previous run's app may still be
        // terminating — `terminate()` only *requests* termination and returns
        // before the process is actually gone — so an unfiltered
        // `runningApplications(...).first` can hand back a zombie whose AX tree is
        // still readable (the launch-race bug: BUG-MAC-001). Reuse a live
        // (non-terminated) instance if one exists; if only terminating instances
        // remain, wait (bounded by the launch timeout) for their PIDs to clear
        // before launching a fresh copy.
        var running: NSRunningApplication? = looksLikePath
            ? nil
            : awaitLaunchableInstance(bundleId: appRef, timeout: timeout)

        if running == nil {
            let url: URL
            if looksLikePath {
                url = URL(fileURLWithPath: appRef)
            } else if let resolved = ws.urlForApplication(withBundleIdentifier: appRef) {
                url = resolved
            } else {
                throw AXFailure("no application found for bundle id \(appRef)")
            }
            let config = NSWorkspace.OpenConfiguration()
            let semaphore = DispatchSemaphore(value: 0)
            let lock = NSLock()
            var launchError: Error?
            ws.openApplication(at: url, configuration: config) { started, error in
                lock.lock()
                running = started
                launchError = error
                lock.unlock()
                semaphore.signal()
            }
            guard semaphore.wait(timeout: .now() + timeout) == .success else {
                throw AXFailure("timed out after \(timeout)s launching \(appRef)")
            }
            lock.lock()
            let launchOutcome = (app: running, error: launchError)
            lock.unlock()
            if let error = launchOutcome.error {
                throw AXFailure("failed to launch \(appRef): \(error.localizedDescription)")
            }
            running = launchOutcome.app
        }

        let deadline = Date().addingTimeInterval(timeout)
        while running?.isFinishedLaunching != true && Date() < deadline {
            usleep(100_000)
        }
        guard let resolved = running else { throw AXFailure("app did not start within \(timeout)s") }

        // Final guard: refuse to attach to a PID that died between resolution and
        // now, so success always means a living process we can drive.
        guard !resolved.isTerminated else {
            throw AXFailure("target \(appRef) terminated during launch")
        }

        self.runningApp = resolved
        self.bundleId = resolved.bundleIdentifier ?? appRef
        let axApp = AXUIElementCreateApplication(resolved.processIdentifier)
        AXUIElementSetMessagingTimeout(axApp, 2.0)
        self.app = axApp
        return ["bundleId": bundleId ?? appRef, "pid": Int(resolved.processIdentifier)]
    }

    func activate() throws -> [String: Any] {
        guard let runningApp else { throw AXFailure("no app attached — send a \"launch\" command first") }
        runningApp.activate(options: [])
        return ["activated": true]
    }

    func quit() -> [String: Any] {
        // Defuse the aggravator first: a status-item menu left open keeps an
        // NSMenu tracking runloop alive and delays clean termination, widening the
        // launch race. Cancel it before asking the app to quit.
        dismissOpenStatusMenu()

        defer {
            runningApp = nil
            app = nil
            bundleId = nil
        }

        guard let target = runningApp, !target.isTerminated else {
            return ["quit": true, "state": "alreadyGone"]
        }

        // `terminate()` only *requests* termination and returns immediately, so
        // poll `isTerminated` until the process is actually gone before returning —
        // otherwise the next run can attach to this still-dying instance.
        target.terminate()
        if waitForTermination(of: target, timeout: terminationTimeout) {
            return ["quit": true, "state": "terminated"]
        }

        // Didn't go quietly; escalate to a forced kill and wait for that.
        target.forceTerminate()
        if waitForTermination(of: target, timeout: terminationTimeout) {
            return ["quit": true, "state": "forced"]
        }

        // Even the forced kill didn't take effect within the deadline. Report
        // honestly rather than pretending the app is gone.
        return ["quit": false, "state": "timedOut"]
    }

    /// Poll `isTerminated` until the app is gone or `timeout` elapses. Returns
    /// whether the process actually terminated.
    private func waitForTermination(of target: NSRunningApplication, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while !target.isTerminated && Date() < deadline {
            usleep(50_000)
        }
        return target.isTerminated
    }

    // MARK: - Element verbs

    func count(_ queryDict: [String: Any]) throws -> [String: Any] {
        let app = try requireApp()
        let query = try Query.from(queryDict)
        return ["count": resolveAll(root: app, query: query).count]
    }

    func text(_ queryDict: [String: Any]) throws -> [String: Any] {
        let app = try requireApp()
        let query = try Query.from(queryDict)
        guard let element = resolveFirst(root: app, query: query) else {
            throw AXFailure("no element matched query")
        }
        let value = axString(element, kAXValueAttribute as String)
            ?? axString(element, kAXTitleAttribute as String)
            ?? axString(element, kAXDescriptionAttribute as String)
        var result: [String: Any] = [:]
        if let value {
            result["text"] = value
        }
        return result
    }

    func click(_ queryDict: [String: Any]) throws -> [String: Any] {
        let element = try firstOrThrow(queryDict)
        let error = axPress(element)
        guard error == .success || error == .cannotComplete else {
            throw AXFailure("AXPress failed (\(error.rawValue))")
        }
        return ["clicked": true]
    }

    func fill(_ queryDict: [String: Any], value: String) throws -> [String: Any] {
        let element = try firstOrThrow(queryDict)
        let status = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString)
        guard status == .success else {
            throw AXFailure("could not set value on element (\(status.rawValue))")
        }
        return ["filled": true]
    }

    func press(_ queryDict: [String: Any], key: String) throws -> [String: Any] {
        let element = try firstOrThrow(queryDict)
        // AX cannot synthesize arbitrary keystrokes at an element; the activating
        // keys map onto AXPress. Anything else is rejected honestly.
        switch key.lowercased() {
        case "enter", "return", "space", " ":
            let error = axPress(element)
            guard error == .success || error == .cannotComplete else {
                throw AXFailure("AXPress failed (\(error.rawValue))")
            }
            return ["pressed": key]
        default:
            throw AXFailure("press key \"\(key)\" is not supported by the macOS target (only Enter/Return/Space)")
        }
    }

    func hover(_ queryDict: [String: Any]) throws -> [String: Any] {
        let element = try firstOrThrow(queryDict)
        guard let frame = axFrame(element) else {
            throw AXFailure("element has no on-screen position to hover")
        }
        CGWarpMouseCursorPosition(CGPoint(x: frame.midX, y: frame.midY))
        return ["hovered": true]
    }

    func scrollTo(_ queryDict: [String: Any]) throws -> [String: Any] {
        let element = try firstOrThrow(queryDict)
        _ = axPerform(element, "AXScrollToVisible")
        return ["scrolled": true]
    }

    func waitFor(_ queryDict: [String: Any], timeout: TimeInterval) throws -> [String: Any] {
        let app = try requireApp()
        let query = try Query.from(queryDict)
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if resolveFirst(root: app, query: query) != nil { return ["found": true] }
            usleep(100_000)
        } while Date() < deadline
        throw AXFailure("timed out after \(timeout)s waiting for element")
    }

    func screenshot(path: String) throws -> [String: Any] {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-x", path]
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw AXFailure("screencapture exited with status \(process.terminationStatus)")
        }
        return ["path": path]
    }

    // MARK: - Menu bar interaction

    func statusItems() throws -> [String: Any] {
        let app = try requireApp()
        return ["items": axStatusItems(app).map(axInfo)]
    }

    func windows() throws -> [String: Any] {
        let app = try requireApp()
        return ["windows": axWindows(app).map(axInfo)]
    }

    private func openStatusMenu(timeout: TimeInterval) throws -> (status: AXUIElement, menu: AXUIElement) {
        let app = try requireApp()
        guard let status = axStatusItems(app).first else {
            throw AXFailure("no status item found (AXExtrasMenuBar empty)")
        }
        axPress(status)
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let menu = axChildren(status).first(where: {
                axString($0, kAXRoleAttribute as String) == "AXMenu"
            }) {
                return (status, menu)
            }
            usleep(100_000)
        }
        throw AXFailure("status-item menu did not open within \(timeout)s")
    }

    func openMenu(timeout: TimeInterval) throws -> [String: Any] {
        let (_, menu) = try openStatusMenu(timeout: timeout)
        return ["items": axChildren(menu).map(axInfo)]
    }

    func closeMenu() throws -> [String: Any] {
        _ = try requireApp()
        return ["closed": dismissOpenStatusMenu()]
    }

    func clickMenu(title: String, timeout: TimeInterval) throws -> [String: Any] {
        let (_, menu) = try openStatusMenu(timeout: timeout)
        let items = axChildren(menu)
        let exact = items.first {
            axString($0, kAXTitleAttribute as String)?.caseInsensitiveCompare(title) == .orderedSame
        }
        guard let target = exact ?? items.first(where: {
            (axString($0, kAXTitleAttribute as String) ?? "").localizedCaseInsensitiveContains(title)
        }) else {
            _ = try? closeMenu()
            let available = items.compactMap { axString($0, kAXTitleAttribute as String) }
            throw AXFailure("no menu item matching \"\(title)\"; items: \(available)")
        }
        if axBool(target, kAXEnabledAttribute as String) == false {
            _ = try? closeMenu()
            throw AXFailure("menu item \"\(title)\" is disabled")
        }
        let error = axPress(target)
        guard error == .success || error == .cannotComplete else {
            _ = try? closeMenu()
            throw AXFailure("AXPress failed on \"\(title)\" (\(error.rawValue))")
        }
        return ["clicked": axString(target, kAXTitleAttribute as String) ?? title]
    }

    func tree(depth: Int) throws -> [String: Any] {
        let app = try requireApp()
        return ["tree": axTree(app, depth: depth)]
    }

    // MARK: - Helpers

    /// Return an already-running, non-terminated instance of `bundleId` to reuse,
    /// or nil when a fresh launch is needed. If only *terminating* instances exist
    /// (a prior run still dying), block until they clear or `timeout` elapses so we
    /// never attach to a dying PID.
    private func awaitLaunchableInstance(
        bundleId: String, timeout: TimeInterval
    ) -> NSRunningApplication? {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            let instances = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            if let live = instances.first(where: { !$0.isTerminated }) {
                return live
            }
            // No live instance. If some are still terminating and there's time
            // left, wait for the dying PID(s) to disappear rather than launching
            // alongside them; otherwise a fresh launch is needed.
            let stillDying = instances.contains { $0.isTerminated }
            guard stillDying && Date() < deadline else { return nil }
            usleep(100_000)
        }
    }

    /// Cancel an open status-item menu if one is showing, returning whether a menu
    /// was dismissed. Best-effort and safe with no app attached — an open menu
    /// keeps an NSMenu tracking runloop alive and delays clean termination, so
    /// `quit()` calls this first to defuse that.
    @discardableResult
    private func dismissOpenStatusMenu() -> Bool {
        guard let app,
              let status = axStatusItems(app).first,
              let menu = axChildren(status).first(where: {
                  axString($0, kAXRoleAttribute as String) == "AXMenu"
              })
        else { return false }
        _ = axPerform(menu, "AXCancel")
        return true
    }

    private func firstOrThrow(_ queryDict: [String: Any]) throws -> AXUIElement {
        let app = try requireApp()
        let query = try Query.from(queryDict)
        guard let element = resolveFirst(root: app, query: query) else {
            throw AXFailure("no element matched query")
        }
        return element
    }
}
