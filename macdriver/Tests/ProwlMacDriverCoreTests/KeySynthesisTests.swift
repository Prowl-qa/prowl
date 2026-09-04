import CoreGraphics
@testable import ProwlMacDriverCore
import XCTest

/// Covers the pure key-name → keystroke parser (PROWL-051 / ARCH-005). The
/// CGEvent posting side is deliberately excluded — this exercises only the
/// mapping table, modifier parsing, aliases, case-insensitivity, and errors.
final class KeySynthesisTests: XCTestCase {
    func testNamedKeysMapToExpectedVirtualKeycodes() throws {
        let expected: [String: CGKeyCode] = [
            "Escape": 53, "Tab": 48, "Return": 36, "Enter": 36, "Space": 49,
            "Backspace": 51, "Delete": 117,
            "Home": 115, "End": 119, "PageUp": 116, "PageDown": 121,
            "ArrowUp": 126, "ArrowDown": 125, "ArrowLeft": 123, "ArrowRight": 124,
            "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97,
            "F7": 98, "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111
        ]
        for (name, code) in expected {
            let keystroke = try KeySynthesis.parse(name)
            XCTAssertEqual(keystroke.keyCode, code, "\(name) should map to \(code)")
            XCTAssertTrue(keystroke.flags.isEmpty, "\(name) should carry no modifiers")
            XCTAssertNil(keystroke.unicodeString, "\(name) is a named key, not a printable char")
        }
    }

    func testBackspaceAndDeleteAreDistinctPerWebSemantics() throws {
        // Backspace deletes left (kVK_Delete 51); Delete deletes right
        // (kVK_ForwardDelete 117) — matching the web target.
        XCTAssertEqual(try KeySynthesis.parse("Backspace").keyCode, 51)
        XCTAssertEqual(try KeySynthesis.parse("Delete").keyCode, 117)
    }

    func testKeyNameMatchingIsCaseInsensitive() throws {
        for variant in ["Escape", "escape", "ESCAPE", "EsCaPe"] {
            XCTAssertEqual(try KeySynthesis.parse(variant).keyCode, 53, "\(variant) should map to Escape")
        }
    }

    func testBareSpaceCharacterIsTheSpaceKey() throws {
        let keystroke = try KeySynthesis.parse(" ")
        XCTAssertEqual(keystroke.keyCode, 49)
        XCTAssertNil(keystroke.unicodeString)
    }

    func testSinglePrintableCharacterRidesOnUnicodeStringWithKeycodeZero() throws {
        let keystroke = try KeySynthesis.parse("a")
        XCTAssertEqual(keystroke.keyCode, 0)
        XCTAssertEqual(keystroke.unicodeString, "a")
        XCTAssertTrue(keystroke.flags.isEmpty)

        let capital = try KeySynthesis.parse("A")
        XCTAssertEqual(capital.unicodeString, "A", "case is preserved for printable characters")
    }

    func testModifiedLetterResolvesToAnsiKeycodeNotUnicodeString() throws {
        // keycode 0 is physically kVK_ANSI_A; a modified letter must carry a real
        // ANSI keycode so an app that reads the keycode can't misread e.g. Meta+s
        // as Cmd+A and fire Select All when the hunt asked for Save.
        let save = try KeySynthesis.parse("Meta+s")
        XCTAssertEqual(save.keyCode, 1, "Meta+s must map to kVK_ANSI_S (1)")
        XCTAssertTrue(save.flags.contains(.maskCommand))
        XCTAssertNil(save.unicodeString, "a modified shortcut carries no unicode string")

        let selectAll = try KeySynthesis.parse("Control+a")
        XCTAssertEqual(selectAll.keyCode, 0, "Control+a maps to kVK_ANSI_A (0)")
        XCTAssertTrue(selectAll.flags.contains(.maskControl))
        XCTAssertNil(selectAll.unicodeString)
    }

    func testBareLetterKeepsUnicodePathWhileModifiedLetterDoesNot() throws {
        // The bare "a" and the modified "Control+a" must parse differently: the
        // bare character stays on the layout-independent unicode path (keycode 0
        // + unicode "a"), the combo resolves a real keycode with no unicode.
        let bare = try KeySynthesis.parse("a")
        let modified = try KeySynthesis.parse("Control+a")
        XCTAssertEqual(bare.unicodeString, "a")
        XCTAssertNil(modified.unicodeString)
        XCTAssertNotEqual(bare, modified)
    }

    func testModifiedNonAnsiCharacterFallsBackToUnicodePath() throws {
        // A modified character with no ANSI mapping (e.g. an accented letter)
        // keeps the unicode fallback rather than erroring.
        let keystroke = try KeySynthesis.parse("Control+é")
        XCTAssertEqual(keystroke.keyCode, 0)
        XCTAssertEqual(keystroke.unicodeString, "é")
        XCTAssertTrue(keystroke.flags.contains(.maskControl))
    }

    func testCommonShortcutPunctuationResolvesToAnsiKeycodes() throws {
        // Spot-check the punctuation used in real shortcuts (e.g. Cmd+-, Cmd+=).
        XCTAssertEqual(try KeySynthesis.parse("Meta+-").keyCode, 27)
        XCTAssertEqual(try KeySynthesis.parse("Meta+=").keyCode, 24)
        for combo in ["Meta+-", "Meta+="] {
            XCTAssertNil(try KeySynthesis.parse(combo).unicodeString)
        }
    }

    func testShiftTabKeepsTheNamedKeycode() throws {
        let keystroke = try KeySynthesis.parse("Shift+Tab")
        XCTAssertTrue(keystroke.flags.contains(.maskShift))
        XCTAssertEqual(keystroke.keyCode, 48)
        XCTAssertNil(keystroke.unicodeString)
    }

    func testMacFriendlyModifierAliasesMapToWebModifiers() throws {
        XCTAssertTrue(try KeySynthesis.parse("Ctrl+a").flags.contains(.maskControl))
        XCTAssertTrue(try KeySynthesis.parse("ControlOrMeta+a").flags.contains(.maskCommand))
        XCTAssertFalse(try KeySynthesis.parse("ControlOrMeta+a").flags.contains(.maskControl))
        XCTAssertTrue(try KeySynthesis.parse("Cmd+s").flags.contains(.maskCommand))
        XCTAssertTrue(try KeySynthesis.parse("Command+s").flags.contains(.maskCommand))
        XCTAssertTrue(try KeySynthesis.parse("Meta+s").flags.contains(.maskCommand))
        XCTAssertTrue(try KeySynthesis.parse("Option+a").flags.contains(.maskAlternate))
        XCTAssertTrue(try KeySynthesis.parse("Opt+a").flags.contains(.maskAlternate))
        XCTAssertTrue(try KeySynthesis.parse("Alt+a").flags.contains(.maskAlternate))
    }

    func testMultipleModifiersCombine() throws {
        let keystroke = try KeySynthesis.parse("Control+Shift+ArrowLeft")
        XCTAssertTrue(keystroke.flags.contains(.maskControl))
        XCTAssertTrue(keystroke.flags.contains(.maskShift))
        XCTAssertEqual(keystroke.keyCode, 123)
    }

    func testModifierNamesAreCaseInsensitive() throws {
        let keystroke = try KeySynthesis.parse("CONTROL+shift+s")
        XCTAssertTrue(keystroke.flags.contains(.maskControl))
        XCTAssertTrue(keystroke.flags.contains(.maskShift))
    }

    func testLiteralPlusKey() throws {
        XCTAssertEqual(try KeySynthesis.parse("+").unicodeString, "+")

        let shifted = try KeySynthesis.parse("Shift++")
        XCTAssertEqual(shifted.keyCode, 24)
        XCTAssertTrue(shifted.flags.contains(.maskShift))
        XCTAssertNil(shifted.unicodeString)

        let commandPlus = try KeySynthesis.parse("Meta++")
        XCTAssertEqual(commandPlus.keyCode, 24)
        XCTAssertTrue(commandPlus.flags.contains(.maskCommand))
        XCTAssertTrue(commandPlus.flags.contains(.maskShift))
        XCTAssertNil(commandPlus.unicodeString)
    }

    func testActivationKeyFlag() throws {
        XCTAssertTrue(try KeySynthesis.parse("Enter").isActivationKey)
        XCTAssertTrue(try KeySynthesis.parse("Return").isActivationKey)
        XCTAssertTrue(try KeySynthesis.parse("Space").isActivationKey)
        XCTAssertTrue(try KeySynthesis.parse(" ").isActivationKey)
        // A modifier disqualifies the AXPress fast path.
        XCTAssertFalse(try KeySynthesis.parse("Shift+Enter").isActivationKey)
        // A non-activation key is not eligible.
        XCTAssertFalse(try KeySynthesis.parse("Escape").isActivationKey)
        XCTAssertFalse(try KeySynthesis.parse("a").isActivationKey)
    }

    func testUnknownKeyThrowsWithVocabularySummary() {
        XCTAssertThrowsError(try KeySynthesis.parse("PrtSc")) { error in
            guard let failure = error as? AXFailure else {
                return XCTFail("expected AXFailure, got \(error)")
            }
            XCTAssertTrue(failure.message.contains("not supported"))
            XCTAssertTrue(failure.message.contains("F1–F12"), "error should summarize supported keys")
        }
    }

    func testUnknownModifierThrows() {
        XCTAssertThrowsError(try KeySynthesis.parse("Hyper+a")) { error in
            guard let failure = error as? AXFailure else {
                return XCTFail("expected AXFailure, got \(error)")
            }
            XCTAssertTrue(failure.message.contains("unknown modifier"))
            XCTAssertTrue(failure.message.contains("Hyper"))
        }
    }

    func testEmptyKeyThrows() {
        XCTAssertThrowsError(try KeySynthesis.parse("")) { error in
            guard let failure = error as? AXFailure else {
                return XCTFail("expected AXFailure, got \(error)")
            }
            XCTAssertTrue(failure.message.contains("empty"))
        }
    }
}
