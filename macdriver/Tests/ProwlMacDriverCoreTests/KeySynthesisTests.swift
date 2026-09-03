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

    func testModifierComboMapsToFlagsPlusKey() throws {
        let keystroke = try KeySynthesis.parse("Control+a")
        XCTAssertTrue(keystroke.flags.contains(.maskControl))
        XCTAssertEqual(keystroke.unicodeString, "a")
        XCTAssertEqual(keystroke.keyCode, 0)
    }

    func testShiftTabKeepsTheNamedKeycode() throws {
        let keystroke = try KeySynthesis.parse("Shift+Tab")
        XCTAssertTrue(keystroke.flags.contains(.maskShift))
        XCTAssertEqual(keystroke.keyCode, 48)
        XCTAssertNil(keystroke.unicodeString)
    }

    func testMacFriendlyModifierAliasesMapToWebModifiers() throws {
        XCTAssertTrue(try KeySynthesis.parse("Ctrl+a").flags.contains(.maskControl))
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
        let combo = try KeySynthesis.parse("Shift++")
        XCTAssertTrue(combo.flags.contains(.maskShift))
        XCTAssertEqual(combo.unicodeString, "+")
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
