// AX.swift — thin wrappers over the Accessibility (AXUIElement) C API.
// Ported from the PROWL-048 `axspike` spike; these primitives proved out
// end-to-end against a real menu bar app (status-item discovery, menu
// open/dump/click, window listing, tree dump).

import AppKit
import ApplicationServices
import Foundation

/// A recoverable failure while driving Accessibility. The serve loop turns these
/// into `{ ok: false, error }` responses instead of crashing the process.
struct AXFailure: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

func axAttr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
    return value
}

func axAsElement(_ value: CFTypeRef) -> AXUIElement? {
    guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(value, to: AXUIElement.self)
}

func axString(_ el: AXUIElement, _ name: String) -> String? {
    axAttr(el, name) as? String
}

func axChildren(_ el: AXUIElement) -> [AXUIElement] {
    (axAttr(el, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

func axBool(_ el: AXUIElement, _ name: String) -> Bool? {
    axAttr(el, name) as? Bool
}

/// A short messaging timeout keeps AXPress from blocking while the target app
/// sits in its menu-tracking loop; `.cannotComplete` afterwards is expected.
@discardableResult
func axPress(_ el: AXUIElement) -> AXError {
    AXUIElementSetMessagingTimeout(el, 1.0)
    return AXUIElementPerformAction(el, kAXPressAction as CFString)
}

func axPerform(_ el: AXUIElement, _ action: String) -> AXError {
    AXUIElementSetMessagingTimeout(el, 1.0)
    return AXUIElementPerformAction(el, action as CFString)
}

/// Whether an element advertises a given action (e.g. `kAXPressAction`). Used to
/// decide whether the AXPress fast path applies before falling back to synthesized
/// key events.
func axSupportsAction(_ el: AXUIElement, _ action: String) -> Bool {
    var names: CFArray?
    guard AXUIElementCopyActionNames(el, &names) == .success,
          let actions = names as? [String] else { return false }
    return actions.contains(action)
}

/// Best-effort read of the on-screen frame of an element (screen coordinates).
func axFrame(_ el: AXUIElement) -> CGRect? {
    guard let posRef = axAttr(el, kAXPositionAttribute as String),
          CFGetTypeID(posRef) == AXValueGetTypeID(),
          let sizeRef = axAttr(el, kAXSizeAttribute as String),
          CFGetTypeID(sizeRef) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(posRef as! AXValue, .cgPoint, &point),
          AXValueGetValue(sizeRef as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}

/// A compact JSON-friendly snapshot of a single element.
func axInfo(_ el: AXUIElement) -> [String: Any] {
    var d: [String: Any] = ["role": axString(el, kAXRoleAttribute as String) ?? "?"]
    if let t = axString(el, kAXTitleAttribute as String), !t.isEmpty { d["title"] = t }
    if let s = axString(el, kAXDescriptionAttribute as String), !s.isEmpty { d["description"] = s }
    if let v = axString(el, kAXValueAttribute as String), !v.isEmpty { d["value"] = v }
    if let i = axString(el, "AXIdentifier"), !i.isEmpty { d["identifier"] = i }
    if let e = axBool(el, kAXEnabledAttribute as String) { d["enabled"] = e }
    return d
}

func axTree(_ el: AXUIElement, depth: Int) -> [String: Any] {
    var d = axInfo(el)
    if depth > 0 {
        let kids = axChildren(el).map { axTree($0, depth: depth - 1) }
        if !kids.isEmpty { d["children"] = kids }
    }
    return d
}

func axWindows(_ app: AXUIElement) -> [AXUIElement] {
    (axAttr(app, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
}

/// Status items live under the app's `AXExtrasMenuBar` (the menu bar extras).
func axStatusItems(_ app: AXUIElement) -> [AXUIElement] {
    guard let value = axAttr(app, "AXExtrasMenuBar"), let bar = axAsElement(value) else { return [] }
    return axChildren(bar)
}
