// Commands.swift — the stateful driver session. Holds the attached app between
// verbs (so the frontmost window and open menus persist across the JSON-over-
// stdio protocol) and implements the SessionDriver verbs the TypeScript
// MacDriver calls.

import AppKit
import ApplicationServices
import Foundation

protocol RunningApplication: AnyObject {
    var bundleIdentifier: String? { get }
    var isFinishedLaunching: Bool { get }
    var isTerminated: Bool { get }
    var processIdentifier: pid_t { get }

    @discardableResult
    func activate(options: NSApplication.ActivationOptions) -> Bool

    @discardableResult
    func terminate() -> Bool

    @discardableResult
    func forceTerminate() -> Bool
}

extension NSRunningApplication: RunningApplication {}

protocol WorkspaceClient {
    func runningApplications(withBundleIdentifier bundleIdentifier: String) -> [RunningApplication]
    func urlForApplication(withBundleIdentifier bundleIdentifier: String) -> URL?
    func openApplication(
        at url: URL,
        configuration: NSWorkspace.OpenConfiguration,
        completionHandler: @escaping (RunningApplication?, Error?) -> Void
    )
}

struct AppKitWorkspaceClient: WorkspaceClient {
    private let workspace: NSWorkspace

    init(workspace: NSWorkspace = .shared) {
        self.workspace = workspace
    }

    func runningApplications(withBundleIdentifier bundleIdentifier: String) -> [RunningApplication] {
        NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
    }

    func urlForApplication(withBundleIdentifier bundleIdentifier: String) -> URL? {
        workspace.urlForApplication(withBundleIdentifier: bundleIdentifier)
    }

    func openApplication(
        at url: URL,
        configuration: NSWorkspace.OpenConfiguration,
        completionHandler: @escaping (RunningApplication?, Error?) -> Void
    ) {
        workspace.openApplication(at: url, configuration: configuration) { started, error in
            completionHandler(started, error)
        }
    }
}

protocol StatusMenuController {
    func dismissOpenStatusMenu(app: AXUIElement?) -> Bool
}

struct AccessibilityStatusMenuController: StatusMenuController {
    func dismissOpenStatusMenu(app: AXUIElement?) -> Bool {
        guard let app,
              let status = axStatusItems(app).first,
              let menu = axChildren(status).first(where: {
                  axString($0, kAXRoleAttribute as String) == "AXMenu"
              })
        else { return false }
        return axPerform(menu, "AXCancel") == .success
    }
}

final class Session {
    private(set) var app: AXUIElement?
    private(set) var bundleId: String?
    private var runningApp: RunningApplication?
    private var blockedReusePids = Set<pid_t>()
    private let workspace: WorkspaceClient
    private let statusMenuController: StatusMenuController
    private let isProcessTrusted: () -> Bool
    private let createApplication: (pid_t) -> AXUIElement
    private let setMessagingTimeout: (AXUIElement, TimeInterval) -> Void
    private let now: () -> Date
    private let sleep: (useconds_t) -> Void

    /// How long `quit()` waits for a graceful terminate before escalating to a
    /// forced kill, and then for that kill to take effect. Kept well under the
    /// helper transport's per-request deadline so a stuck quit still returns an
    /// honest result instead of hanging the caller.
    private let terminationTimeout: TimeInterval

    init(
        workspace: WorkspaceClient = AppKitWorkspaceClient(),
        statusMenuController: StatusMenuController = AccessibilityStatusMenuController(),
        isProcessTrusted: @escaping () -> Bool = AXIsProcessTrusted,
        createApplication: @escaping (pid_t) -> AXUIElement = AXUIElementCreateApplication,
        setMessagingTimeout: @escaping (AXUIElement, TimeInterval) -> Void = { element, timeout in
            AXUIElementSetMessagingTimeout(element, Float(timeout))
        },
        now: @escaping () -> Date = Date.init,
        sleep: @escaping (useconds_t) -> Void = { usleep($0) },
        terminationTimeout: TimeInterval = 5.0
    ) {
        self.workspace = workspace
        self.statusMenuController = statusMenuController
        self.isProcessTrusted = isProcessTrusted
        self.createApplication = createApplication
        self.setMessagingTimeout = setMessagingTimeout
        self.now = now
        self.sleep = sleep
        self.terminationTimeout = terminationTimeout
    }

    private func requireApp() throws -> AXUIElement {
        guard let app else { throw AXFailure("no app attached — send a \"launch\" command first") }
        return app
    }

    private func requireTrusted() throws {
        guard isProcessTrusted() else {
            throw AXFailure(
                "not trusted for Accessibility — grant the hosting terminal/app permission in "
                    + "System Settings → Privacy & Security → Accessibility"
            )
        }
    }

    // MARK: - Lifecycle

    func check() -> [String: Any] {
        ["trusted": isProcessTrusted()]
    }

    func launch(app appRef: String, timeout: TimeInterval) throws -> [String: Any] {
        try requireTrusted()
        let looksLikePath = appRef.contains("/") || appRef.hasSuffix(".app")

        // Never attach to a dying instance. A previous run's app may still be
        // terminating — `terminate()` only *requests* termination and returns
        // before the process is actually gone — so an unfiltered
        // `runningApplications(...).first` can hand back a zombie whose AX tree is
        // still readable (the launch-race bug: BUG-MAC-001). Reuse a live
        // (non-terminated) instance if one exists; if only terminating instances
        // remain, wait (bounded by the launch timeout) for their PIDs to clear
        // before launching a fresh copy.
        var running: RunningApplication? = looksLikePath
            ? nil
            : try awaitLaunchableInstance(bundleId: appRef, timeout: timeout)

        if running == nil {
            let url: URL
            if looksLikePath {
                url = URL(fileURLWithPath: appRef)
            } else if let resolved = workspace.urlForApplication(withBundleIdentifier: appRef) {
                url = resolved
            } else {
                throw AXFailure("no application found for bundle id \(appRef)")
            }
            let config = NSWorkspace.OpenConfiguration()
            let semaphore = DispatchSemaphore(value: 0)
            let lock = NSLock()
            var launchError: Error?
            workspace.openApplication(at: url, configuration: config) { started, error in
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

        let deadline = now().addingTimeInterval(timeout)
        while running?.isFinishedLaunching != true && now() < deadline {
            sleep(100_000)
        }
        guard let resolved = running else { throw AXFailure("app did not start within \(timeout)s") }

        // Final guard: refuse to attach to a PID that died between resolution and
        // now, so success always means a living process we can drive.
        guard !resolved.isTerminated else {
            throw AXFailure("target \(appRef) terminated during launch")
        }

        blockedReusePids.remove(resolved.processIdentifier)
        self.runningApp = resolved
        self.bundleId = resolved.bundleIdentifier ?? appRef
        let axApp = createApplication(resolved.processIdentifier)
        setMessagingTimeout(axApp, 2.0)
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
        _ = target.terminate()
        if waitForTermination(of: target, timeout: terminationTimeout) {
            blockedReusePids.remove(target.processIdentifier)
            return ["quit": true, "state": "terminated"]
        }

        // Didn't go quietly; escalate to a forced kill and wait for that.
        _ = target.forceTerminate()
        if waitForTermination(of: target, timeout: terminationTimeout) {
            blockedReusePids.remove(target.processIdentifier)
            return ["quit": true, "state": "forced"]
        }

        // Even the forced kill didn't take effect within the deadline. Report
        // honestly rather than pretending the app is gone.
        blockedReusePids.insert(target.processIdentifier)
        return ["quit": false, "state": "timedOut"]
    }

    /// Poll `isTerminated` until the app is gone or `timeout` elapses. Returns
    /// whether the process actually terminated.
    private func waitForTermination(of target: RunningApplication, timeout: TimeInterval) -> Bool {
        let deadline = now().addingTimeInterval(timeout)
        while !target.isTerminated && now() < deadline {
            sleep(50_000)
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
    ) throws -> RunningApplication? {
        let deadline = now().addingTimeInterval(timeout)
        while true {
            let instances = workspace.runningApplications(withBundleIdentifier: bundleId)
            pruneReusablePidBlocks(from: instances)
            if let live = instances.first(where: {
                !$0.isTerminated && !blockedReusePids.contains($0.processIdentifier)
            }) {
                return live
            }
            let unresolvedBlockedPids = instances
                .filter { !$0.isTerminated && blockedReusePids.contains($0.processIdentifier) }
                .map(\.processIdentifier)
            guard !unresolvedBlockedPids.isEmpty else { return nil }
            guard now() < deadline else {
                let pids = unresolvedBlockedPids.map(String.init).joined(separator: ", ")
                throw AXFailure(
                    "timed out after \(timeout)s waiting for previous \(bundleId) instance(s) "
                        + "to exit (pid(s): \(pids))"
                )
            }
            sleep(100_000)
        }
    }

    private func pruneReusablePidBlocks(from instances: [RunningApplication]) {
        let activeBlockedPids = Set(instances.compactMap { instance -> pid_t? in
            guard !instance.isTerminated,
                  blockedReusePids.contains(instance.processIdentifier)
            else { return nil }
            return instance.processIdentifier
        })
        blockedReusePids = blockedReusePids.intersection(activeBlockedPids)
    }

    /// Cancel an open status-item menu if one is showing, returning whether a menu
    /// was dismissed. Best-effort and safe with no app attached — an open menu
    /// keeps an NSMenu tracking runloop alive and delays clean termination, so
    /// `quit()` calls this first to defuse that.
    @discardableResult
    private func dismissOpenStatusMenu() -> Bool {
        guard let app,
              statusMenuController.dismissOpenStatusMenu(app: app)
        else { return false }
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
