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
        var running: NSRunningApplication? = looksLikePath
            ? nil
            : NSRunningApplication.runningApplications(withBundleIdentifier: appRef).first

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
            var launchError: Error?
            ws.openApplication(at: url, configuration: config) { started, error in
                running = started
                launchError = error
                semaphore.signal()
            }
            _ = semaphore.wait(timeout: .now() + timeout)
            if let launchError {
                throw AXFailure("failed to launch \(appRef): \(launchError.localizedDescription)")
            }
        }

        let deadline = Date().addingTimeInterval(timeout)
        while running?.isFinishedLaunching != true && Date() < deadline {
            usleep(100_000)
        }
        guard let resolved = running else { throw AXFailure("app did not start within \(timeout)s") }

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
        let terminated = runningApp?.terminate() ?? false
        runningApp = nil
        app = nil
        bundleId = nil
        return ["quit": terminated]
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
        return ["text": value as Any]
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
        let app = try requireApp()
        guard let status = axStatusItems(app).first else { return ["closed": false] }
        if let menu = axChildren(status).first(where: {
            axString($0, kAXRoleAttribute as String) == "AXMenu"
        }) {
            _ = axPerform(menu, "AXCancel")
            return ["closed": true]
        }
        return ["closed": false]
    }

    func clickMenu(title: String, timeout: TimeInterval) throws -> [String: Any] {
        let (_, menu) = try openStatusMenu(timeout: timeout)
        let items = axChildren(menu)
        guard let target = items.first(where: {
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

    private func firstOrThrow(_ queryDict: [String: Any]) throws -> AXUIElement {
        let app = try requireApp()
        let query = try Query.from(queryDict)
        guard let element = resolveFirst(root: app, query: query) else {
            throw AXFailure("no element matched query")
        }
        return element
    }
}
