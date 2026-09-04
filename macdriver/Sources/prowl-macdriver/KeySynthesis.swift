// KeySynthesis.swift — turn a Playwright-style key name (the vocabulary the web
// target documents) into the virtual-keycode + modifier flags a CGEvent needs.
//
// PROWL-051 / ARCH-005: the macOS `press` verb used to reject everything except
// Enter/Return/Space. This parser lets `press` accept the same key vocabulary as
// the web target (Escape, Tab, arrows, Backspace/Delete, Home/End, PageUp/Down,
// F1–F12, single printable characters, and `+`-joined modifier combos).
//
// The parse is a PURE function, deliberately split from the CGEvent posting side
// (which has irreproducible side effects), so `swift test` can cover the whole
// mapping table — names, aliases, case-insensitivity, combos, and error paths —
// without touching the window server.

import CoreGraphics
import Foundation

/// A resolved keystroke: the virtual key to post, the modifier flags to hold,
/// and — for a single printable character — the Unicode string to stamp on the
/// event so the result is keyboard-layout independent.
struct Keystroke: Equatable {
    /// Carbon virtual keycode (`kVK_*`). `0` when the character is delivered via
    /// `unicodeString` instead of a mapped physical key.
    let keyCode: CGKeyCode
    let flags: CGEventFlags
    /// Set for printable single characters; nil for named keys.
    let unicodeString: String?

    /// True when this is a bare Enter/Return/Space with no modifiers — the case
    /// that can take the deterministic, focus-independent AXPress fast path.
    var isActivationKey: Bool {
        unicodeString == nil
            && flags.isEmpty
            && (keyCode == KeySynthesis.returnKeyCode || keyCode == KeySynthesis.spaceKeyCode)
    }
}

enum KeySynthesis {
    static let returnKeyCode: CGKeyCode = 36
    static let spaceKeyCode: CGKeyCode = 49

    /// Named-key vocabulary → Carbon virtual keycode (`kVK_*`). Lookups are
    /// case-insensitive (the table is keyed on lowercased names). Mirrors the
    /// Playwright key names the web `press` step accepts, plus a few macOS-honest
    /// aliases (`esc`, bare arrow names).
    static let namedKeys: [String: CGKeyCode] = [
        "escape": 53, "esc": 53,
        "tab": 48,
        "return": returnKeyCode, "enter": returnKeyCode,
        "space": spaceKeyCode,
        // Web semantics: Backspace deletes left (kVK_Delete), Delete deletes
        // right (kVK_ForwardDelete). Keep them distinct, matching the web target.
        "backspace": 51,
        "delete": 117, "forwarddelete": 117,
        "home": 115, "end": 119,
        "pageup": 116, "pagedown": 121,
        "arrowup": 126, "arrowdown": 125, "arrowleft": 123, "arrowright": 124,
        "up": 126, "down": 125, "left": 123, "right": 124,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
        "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111
    ]

    /// Printable characters → their ANSI (US physical layout) virtual keycode.
    /// Used for a character in a modifier combo (e.g. `Meta+s`): keycode 0 is
    /// physically `kVK_ANSI_A`, so emitting a modified character on the Unicode
    /// path with keycode 0 makes an app that reads the keycode (or the
    /// charactersIgnoringModifiers derived from it) see `Cmd+A` — firing Select
    /// All when the hunt asked for Save. Resolving a real keycode avoids that
    /// misfire. Shortcut letters in combos therefore assume a US/ANSI physical
    /// layout — the standard synthesized-keystroke trade-off.
    static let ansiKeyCodes: [String: CGKeyCode] = [
        "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3, "g": 5, "h": 4,
        "i": 34, "j": 38, "k": 40, "l": 37, "m": 46, "n": 45, "o": 31, "p": 35,
        "q": 12, "r": 15, "s": 1, "t": 17, "u": 32, "v": 9, "w": 13, "x": 7,
        "y": 16, "z": 6,
        "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26,
        "8": 28, "9": 25,
        "-": 27, "=": 24, "+": 24, "[": 33, "]": 30, ";": 41, "'": 39, ",": 43,
        ".": 47, "/": 44, "\\": 42, "`": 50
    ]

    /// One-line summary of the supported vocabulary, used in the unknown-key
    /// error so the message stays a category summary rather than 100 names.
    static let vocabularySummary =
        "supported: single printable characters; Enter, Return, Space, Tab, Escape, "
            + "Backspace, Delete, Home, End, PageUp, PageDown; arrows "
            + "(ArrowUp/ArrowDown/ArrowLeft/ArrowRight); F1–F12; and combos joined with "
            + "\"+\" using Control/Shift/Alt/Meta/ControlOrMeta "
            + "(aliases: Ctrl, Option/Opt, Cmd/Command), e.g. \"Control+a\", "
            + "\"ControlOrMeta+a\", \"Shift+Tab\", \"Meta+s\""

    /// Parse a key name into a {@link Keystroke}, throwing an {@link AXFailure}
    /// with the vocabulary summary for anything unrecognized. Pure — no I/O, no
    /// event posting — so it is fully unit-testable.
    static func parse(_ raw: String) throws -> Keystroke {
        // A lone space is the Space key; trimming would erase it, so special-case
        // it before touching whitespace.
        if raw == " " {
            return Keystroke(keyCode: spaceKeyCode, flags: [], unicodeString: nil)
        }

        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            throw AXFailure("press key is empty; \(vocabularySummary)")
        }

        // Split "Mod+Mod+Key" into leading modifiers and a trailing key. A key of
        // literal "+" surfaces as two trailing empty segments ("Shift++" →
        // ["Shift", "", ""]); collapse those to a "+" key.
        var segments = trimmed.components(separatedBy: "+")
        let keyToken: String
        if segments.count >= 2,
           segments[segments.count - 1].isEmpty,
           segments[segments.count - 2].isEmpty {
            keyToken = "+"
            segments.removeLast(2)
        } else {
            keyToken = segments.removeLast()
        }
        let modifierTokens = segments

        var flags: CGEventFlags = []
        for token in modifierTokens {
            switch token.trimmingCharacters(in: .whitespaces).lowercased() {
            case "control", "ctrl": flags.insert(.maskControl)
            case "shift": flags.insert(.maskShift)
            case "alt", "option", "opt": flags.insert(.maskAlternate)
            case "meta", "cmd", "command": flags.insert(.maskCommand)
            case "controlormeta": flags.insert(.maskCommand)
            case "":
                throw AXFailure("press key \"\(raw)\" has an empty modifier; \(vocabularySummary)")
            default:
                throw AXFailure("press key \"\(raw)\" has unknown modifier \"\(token)\"; \(vocabularySummary)")
            }
        }

        guard !keyToken.isEmpty else {
            throw AXFailure("press key \"\(raw)\" is missing a key after its modifier(s); \(vocabularySummary)")
        }

        if let keyCode = namedKeys[keyToken.lowercased()] {
            return Keystroke(keyCode: keyCode, flags: flags, unicodeString: nil)
        }

        if keyToken.count == 1 {
            // A modified character (a shortcut like `Meta+s`) must resolve to a
            // real physical keycode: keycode 0 is `kVK_ANSI_A`, so the Unicode-
            // string path would let an app read `Meta+s` as Cmd+A and misfire.
            // Fall back to the Unicode path only for a modified character with no
            // ANSI mapping (rare — accented characters, etc.).
            if !flags.isEmpty, keyToken == "+" {
                flags.insert(.maskShift)
            }
            if !flags.isEmpty, let ansi = ansiKeyCodes[keyToken.lowercased()] {
                return Keystroke(keyCode: ansi, flags: flags, unicodeString: nil)
            }
            // A bare printable character rides on the event's Unicode string with
            // keycode 0, so plain typing stays keyboard-layout independent.
            return Keystroke(keyCode: 0, flags: flags, unicodeString: keyToken)
        }

        throw AXFailure("press key \"\(raw)\" is not supported by the macOS target; \(vocabularySummary)")
    }
}
