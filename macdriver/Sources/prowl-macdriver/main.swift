// prowl-macdriver — Accessibility helper behind Prowl's experimental macOS
// execution target (PROWL-048 / ARCH-002).
//
// Modes:
//   prowl-macdriver serve   Long-lived JSON-over-stdio loop (how Prowl drives it).
//                           Reads one JSON request per line on stdin, writes one
//                           JSON response per line on stdout. State (the attached
//                           app, open menus) persists across requests.
//   prowl-macdriver check   One-shot Accessibility-permission preflight; prints
//                           {"trusted": bool} and exits 0 (trusted) or 1.
//
// Request:  {"id": <n>, "cmd": "<verb>", ...args}
// Response: {"id": <n>, "ok": true, "result": {...}}
//        or {"id": <n>, "ok": false, "error": "<message>"}

import ApplicationServices
import Foundation

func writeStdoutLine(_ object: [String: Any], fallbackId: Any? = nil) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else {
        var fallback: [String: Any] = ["ok": false, "error": "failed to encode response"]
        if let fallbackId {
            fallback["id"] = fallbackId
        }
        guard let fallbackData = try? JSONSerialization.data(withJSONObject: fallback, options: []) else {
            let stderr = "failed to encode response and fallback response\n"
            FileHandle.standardError.write(Data(stderr.utf8))
            return
        }
        var line = fallbackData
        line.append(0x0A) // newline
        FileHandle.standardOutput.write(line)
        return
    }
    var line = data
    line.append(0x0A) // newline
    FileHandle.standardOutput.write(line)
}

func writeStderr(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

func double(_ value: Any?, default fallback: Double) -> Double {
    if let d = value as? Double { return d }
    if let i = value as? Int { return Double(i) }
    return fallback
}

func int(_ value: Any?, default fallback: Int) -> Int {
    if let i = value as? Int { return i }
    if let d = value as? Double { return Int(d) }
    return fallback
}

let session = Session()

/// Execute one decoded request, returning the `result` payload or throwing.
func handle(_ request: [String: Any]) throws -> [String: Any] {
    guard let cmd = request["cmd"] as? String else { throw AXFailure("request is missing \"cmd\"") }
    func query() throws -> [String: Any] {
        guard let q = request["query"] as? [String: Any] else { throw AXFailure("\(cmd) requires a query") }
        return q
    }
    let timeout = double(request["timeout"], default: 10.0)

    switch cmd {
    case "check": return session.check()
    case "launch":
        guard let app = request["app"] as? String else { throw AXFailure("launch requires app") }
        return try session.launch(app: app, timeout: timeout)
    case "activate": return try session.activate()
    case "quit": return session.quit()
    case "count": return try session.count(try query())
    case "text": return try session.text(try query())
    case "click": return try session.click(try query())
    case "fill":
        guard let value = request["value"] as? String else { throw AXFailure("fill requires value") }
        return try session.fill(try query(), value: value)
    case "press":
        guard let key = request["key"] as? String else { throw AXFailure("press requires key") }
        return try session.press(try query(), key: key)
    case "hover": return try session.hover(try query())
    case "scrollTo": return try session.scrollTo(try query())
    case "waitFor": return try session.waitFor(try query(), timeout: timeout)
    case "screenshot":
        guard let path = request["path"] as? String else { throw AXFailure("screenshot requires path") }
        return try session.screenshot(path: path)
    case "statusItems": return try session.statusItems()
    case "windows": return try session.windows()
    case "openMenu": return try session.openMenu(timeout: timeout)
    case "closeMenu": return try session.closeMenu()
    case "clickMenu":
        guard let title = request["title"] as? String else { throw AXFailure("clickMenu requires title") }
        return try session.clickMenu(title: title, timeout: timeout)
    case "tree": return try session.tree(depth: int(request["depth"], default: 6))
    default: throw AXFailure("unknown command \"\(cmd)\"")
    }
}

func serve() {
    while let line = readLine(strippingNewline: true) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { continue }
        guard let data = trimmed.data(using: .utf8),
              let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            writeStdoutLine(["ok": false, "error": "malformed JSON request"])
            continue
        }
        let id = request["id"]
        if (request["cmd"] as? String) == "shutdown" {
            var response: [String: Any] = ["ok": true, "result": ["shutdown": true]]
            if let id { response["id"] = id }
            writeStdoutLine(response, fallbackId: id)
            return
        }
        do {
            let result = try handle(request)
            var response: [String: Any] = ["ok": true, "result": result]
            if let id { response["id"] = id }
            writeStdoutLine(response, fallbackId: id)
        } catch let failure as AXFailure {
            var response: [String: Any] = ["ok": false, "error": failure.message]
            if let id { response["id"] = id }
            writeStdoutLine(response, fallbackId: id)
        } catch {
            var response: [String: Any] = ["ok": false, "error": error.localizedDescription]
            if let id { response["id"] = id }
            writeStdoutLine(response, fallbackId: id)
        }
    }
}

// MARK: - Entry

let mode = CommandLine.arguments.dropFirst().first ?? "serve"
switch mode {
case "serve":
    serve()
case "check":
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    let trusted = AXIsProcessTrustedWithOptions(options)
    writeStdoutLine(["trusted": trusted])
    exit(trusted ? 0 : 1)
default:
    writeStderr("usage: prowl-macdriver [serve|check]")
    exit(2)
}
