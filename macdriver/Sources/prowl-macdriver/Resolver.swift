// Resolver.swift — turn a structured selector query (sent by the TypeScript
// MacDriver) into matching AXUIElements by walking the app's accessibility tree.
//
// The TS side parses Prowl's selector dialect (`id=…`, `role=button[name="…"]`,
// bare text) into one of these query shapes, so Swift never parses selector
// strings — it only matches attributes.

import ApplicationServices
import Foundation

enum Query {
    case identifier(String)
    case role(role: String, name: String?)
    case text(String)
    case label(String)

    /// Build a query from the decoded JSON `query` object.
    static func from(_ dict: [String: Any]) throws -> Query {
        guard let by = dict["by"] as? String else {
            throw AXFailure("query is missing a \"by\" discriminant")
        }
        switch by {
        case "id":
            guard let value = dict["value"] as? String else { throw AXFailure("id query requires value") }
            return .identifier(value)
        case "role":
            guard let role = dict["role"] as? String else { throw AXFailure("role query requires role") }
            return .role(role: role, name: dict["name"] as? String)
        case "text":
            guard let value = dict["value"] as? String else { throw AXFailure("text query requires value") }
            return .text(value)
        case "label":
            guard let value = dict["value"] as? String else { throw AXFailure("label query requires value") }
            return .label(value)
        default:
            throw AXFailure("unknown query kind \"\(by)\"")
        }
    }
}

/// Map a subset of ARIA/Playwright role names onto AX roles. An already-AX role
/// (e.g. "AXButton") or an unknown role is matched verbatim.
func axRole(forQueryRole role: String) -> String {
    if role.hasPrefix("AX") { return role }
    switch role.lowercased() {
    case "button": return "AXButton"
    case "link": return "AXLink"
    case "checkbox": return "AXCheckBox"
    case "radio": return "AXRadioButton"
    case "textbox", "textfield": return "AXTextField"
    case "menuitem": return "AXMenuItem"
    case "tab": return "AXTab"
    case "image", "img": return "AXImage"
    case "heading": return "AXHeading"
    case "cell": return "AXCell"
    case "row": return "AXRow"
    default: return "AX" + role.prefix(1).uppercased() + role.dropFirst()
    }
}

private func caseInsensitiveContains(_ haystack: String?, _ needle: String) -> Bool {
    guard let haystack else { return false }
    return haystack.localizedCaseInsensitiveContains(needle)
}

private func nameFields(_ el: AXUIElement) -> [String?] {
    [
        axString(el, kAXTitleAttribute as String),
        axString(el, kAXDescriptionAttribute as String),
        axString(el, kAXValueAttribute as String)
    ]
}

func matches(_ el: AXUIElement, _ query: Query) -> Bool {
    switch query {
    case .identifier(let id):
        return axString(el, "AXIdentifier") == id
    case .role(let role, let name):
        guard axString(el, kAXRoleAttribute as String) == axRole(forQueryRole: role) else { return false }
        guard let name, !name.isEmpty else { return true }
        return nameFields(el).contains { caseInsensitiveContains($0, name) }
    case .text(let text):
        return nameFields(el).contains { caseInsensitiveContains($0, text) }
    case .label(let label):
        // Labels address a control by its accessibility title/description exactly.
        return nameFields(el).contains { $0?.caseInsensitiveCompare(label) == .orderedSame }
    }
}

/// Depth-bounded pre-order walk collecting every element matching `query`.
func resolveAll(root: AXUIElement, query: Query, maxDepth: Int = 20) -> [AXUIElement] {
    var found: [AXUIElement] = []
    func visit(_ el: AXUIElement, _ depth: Int) {
        if matches(el, query) { found.append(el) }
        if depth <= 0 { return }
        for child in axChildren(el) { visit(child, depth - 1) }
    }
    visit(root, maxDepth)
    return found
}

func resolveFirst(root: AXUIElement, query: Query, maxDepth: Int = 20) -> AXUIElement? {
    resolveAll(root: root, query: query, maxDepth: maxDepth).first
}
