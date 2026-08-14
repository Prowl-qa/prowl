// axspike — proof-of-concept AX automation helper for the future Prowl MacDriver (PROWL-048).
// Drives a macOS menu bar app via the Accessibility API (AXUIElement).
// Not shipped; lives outside the npm tarball. See spikes/macdriver/README.md.

import AppKit
import ApplicationServices
import Foundation

let defaultBundleId = "com.tookes.Sentwise"

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write(Data(("error: " + msg + "\n").utf8))
    exit(2)
}

func printJSON(_ obj: Any) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]),
          let text = String(data: data, encoding: .utf8) else { fail("could not encode JSON") }
    print(text)
}

// MARK: - AX primitives

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value
}

func axElement(_ value: CFTypeRef) -> AXUIElement? {
    guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(value, to: AXUIElement.self)
}

func stringAttr(_ el: AXUIElement, _ name: String) -> String? {
    attr(el, name) as? String
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

@discardableResult
func press(_ el: AXUIElement) -> AXError {
    // A short messaging timeout keeps AXPress from blocking while the target
    // app sits in its menu-tracking loop; .cannotComplete after opening is normal.
    AXUIElementSetMessagingTimeout(el, 1.0)
    return AXUIElementPerformAction(el, kAXPressAction as CFString)
}

func info(_ el: AXUIElement) -> [String: Any] {
    var d: [String: Any] = ["role": stringAttr(el, kAXRoleAttribute as String) ?? "?"]
    if let t = stringAttr(el, kAXTitleAttribute as String), !t.isEmpty { d["title"] = t }
    if let s = stringAttr(el, kAXDescriptionAttribute as String), !s.isEmpty { d["description"] = s }
    if let i = stringAttr(el, "AXIdentifier"), !i.isEmpty { d["identifier"] = i }
    if let e = attr(el, kAXEnabledAttribute as String) as? Bool { d["enabled"] = e }
    return d
}

func tree(_ el: AXUIElement, depth: Int) -> [String: Any] {
    var d = info(el)
    if depth > 0 {
        let kids = children(el).map { tree($0, depth: depth - 1) }
        if !kids.isEmpty { d["children"] = kids }
    }
    return d
}

// MARK: - App / status item lookup

func appElement(bundleId: String) -> AXUIElement {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first else {
        fail("no running app with bundle id \(bundleId) — launch it first")
    }
    let el = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(el, 2.0)
    return el
}

func statusItems(_ app: AXUIElement) -> [AXUIElement] {
    guard let value = attr(app, "AXExtrasMenuBar"), let bar = axElement(value) else { return [] }
    return children(bar)
}

func openMenu(_ app: AXUIElement, timeout: TimeInterval) -> (status: AXUIElement, menu: AXUIElement) {
    guard let status = statusItems(app).first else {
        fail("no status item found (AXExtrasMenuBar empty)")
    }
    press(status)
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if let menu = children(status).first(where: { stringAttr($0, kAXRoleAttribute as String) == "AXMenu" }) {
            return (status, menu)
        }
        usleep(100_000)
    }
    fail("menu did not open within \(timeout)s")
}

func closeMenu(_ app: AXUIElement) {
    guard let status = statusItems(app).first else { return }
    if let menu = children(status).first(where: { stringAttr($0, kAXRoleAttribute as String) == "AXMenu" }) {
        AXUIElementSetMessagingTimeout(menu, 1.0)
        AXUIElementPerformAction(menu, "AXCancel" as CFString)
    }
}

func windows(_ app: AXUIElement) -> [AXUIElement] {
    (attr(app, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
}

// MARK: - Command line

var args = Array(CommandLine.arguments.dropFirst())
var bundleId = defaultBundleId
var timeoutSecs = 10.0
var depth = 6

func takeOption(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    let value = args[i + 1]
    args.removeSubrange(i...(i + 1))
    return value
}

if let v = takeOption("--bundle-id") { bundleId = v }
if let v = takeOption("--timeout") {
    guard let t = Double(v), t > 0 else { fail("--timeout must be a positive number, got \"\(v)\"") }
    timeoutSecs = t
}
if let v = takeOption("--depth") {
    guard let d = Int(v), d >= 0 else { fail("--depth must be a non-negative integer, got \"\(v)\"") }
    depth = d
}

guard let command = args.first else {
    fail("""
    usage: axspike <command> [args] [--bundle-id <id>] [--timeout <s>] [--depth <n>]
    commands: check | status-items | open-menu | click-menu <title> | close-menu | windows | assert-window <title> | tree
    """)
}

func requireTrust() {
    guard AXIsProcessTrusted() else {
        fail("this process is not trusted for Accessibility — run `axspike check` and grant permission in System Settings > Privacy & Security > Accessibility")
    }
}

switch command {
case "check":
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    let trusted = AXIsProcessTrustedWithOptions(opts)
    printJSON(["trusted": trusted])
    exit(trusted ? 0 : 1)

case "status-items":
    requireTrust()
    let app = appElement(bundleId: bundleId)
    printJSON(statusItems(app).map { info($0) })

case "open-menu":
    requireTrust()
    let app = appElement(bundleId: bundleId)
    let (_, menu) = openMenu(app, timeout: timeoutSecs)
    printJSON(children(menu).map { info($0) })

case "click-menu":
    requireTrust()
    guard args.count >= 2 else { fail("usage: axspike click-menu <title-substring>") }
    let title = args[1]
    let app = appElement(bundleId: bundleId)
    let (_, menu) = openMenu(app, timeout: timeoutSecs)
    let items = children(menu)
    guard let target = items.first(where: {
        (stringAttr($0, kAXTitleAttribute as String) ?? "").localizedCaseInsensitiveContains(title)
    }) else {
        closeMenu(app)
        fail("no menu item matching \"\(title)\"; items: \(items.compactMap { stringAttr($0, kAXTitleAttribute as String) })")
    }
    if attr(target, kAXEnabledAttribute as String) as? Bool == false {
        closeMenu(app)
        fail("menu item \"\(title)\" is disabled")
    }
    let err = press(target)
    // .cannotComplete is expected while the app is in its menu-tracking loop.
    guard err == .success || err == .cannotComplete else {
        closeMenu(app)
        fail("AXPress failed on \"\(title)\": \(err.rawValue)")
    }
    printJSON(["clicked": stringAttr(target, kAXTitleAttribute as String) ?? title])

case "close-menu":
    requireTrust()
    closeMenu(appElement(bundleId: bundleId))
    printJSON(["closed": true])

case "windows":
    requireTrust()
    let app = appElement(bundleId: bundleId)
    printJSON(windows(app).map { info($0) })

case "assert-window":
    requireTrust()
    guard args.count >= 2 else { fail("usage: axspike assert-window <title-substring>") }
    let title = args[1]
    let app = appElement(bundleId: bundleId)
    let deadline = Date().addingTimeInterval(timeoutSecs)
    while Date() < deadline {
        if let w = windows(app).first(where: {
            (stringAttr($0, kAXTitleAttribute as String) ?? "").localizedCaseInsensitiveContains(title)
        }) {
            printJSON(["found": true, "window": info(w)])
            exit(0)
        }
        usleep(200_000)
    }
    printJSON(["found": false])
    exit(1)

case "tree":
    requireTrust()
    let app = appElement(bundleId: bundleId)
    printJSON(tree(app, depth: depth))

default:
    fail("unknown command: \(command)")
}
