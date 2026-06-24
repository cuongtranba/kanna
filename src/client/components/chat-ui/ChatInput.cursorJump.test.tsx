/**
 * ChatInput cursor / input behaviour tests.
 *
 * The original file (ChatInput.cursorJump.test.tsx) tested textarea-specific
 * behaviour:
 *   1. `shouldRefreshPickerOnSelection` – pure utility, still exported.
 *   2. `isTouchDeviceEnvironment`       – pure utility, still exported.
 *   3. "ChatInput onSelect wiring"      – verified that `select` events on a
 *      controlled <textarea> did NOT trigger extra React renders on touch
 *      devices (the caretVersion/pickerDismissed bump suppression guard).
 *
 * With the Lexical migration the controlled-textarea is gone. Lexical manages
 * its own selection internally and does not fire React `onSelect` events that
 * could cause spurious re-renders via a `caretVersion` state integer.
 * The third test suite ("ChatInput onSelect wiring") therefore has NO
 * equivalent under the Lexical editor — the entire problem it guarded against
 * cannot occur. The test is intentionally removed; its intent is documented
 * here for the orchestrator.
 *
 * NOTE: `shouldRefreshPickerOnSelection` is still exported for back-compat
 * (external callers might import it) but it is no longer used internally by
 * ChatInput — the Lexical typeahead plugins own their own query-refresh logic.
 */

import "../../lib/testing/setupHappyDom"
import { afterEach, describe, expect, test } from "bun:test"
import {
  isTouchDeviceEnvironment,
  shouldRefreshPickerOnSelection,
} from "./ChatInput"

// ---------------------------------------------------------------------------
// Touch device detection helpers
// ---------------------------------------------------------------------------

function setTouchDevice(on: boolean) {
  if (on) {
    Object.defineProperty(window, "ontouchstart", { configurable: true, value: null })
  } else if ("ontouchstart" in window) {
    delete (window as unknown as { ontouchstart?: unknown }).ontouchstart
  }
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: on ? 5 : 0,
  })
}

// ---------------------------------------------------------------------------
// shouldRefreshPickerOnSelection (pure utility)
// ---------------------------------------------------------------------------

describe("shouldRefreshPickerOnSelection", () => {
  test("desktop -> picker refreshes on caret moves (Arrow keys, mouse clicks)", () => {
    expect(shouldRefreshPickerOnSelection(false)).toBe(true)
  })

  test("touch device -> picker does NOT refresh (iOS hold-space cursor-drag safety)", () => {
    // This utility is kept for back-compat export. Under Lexical the
    // typeahead plugins track query changes internally so this guard is
    // no longer wired to any React state update inside ChatInput.
    expect(shouldRefreshPickerOnSelection(true)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isTouchDeviceEnvironment
// ---------------------------------------------------------------------------

describe("isTouchDeviceEnvironment", () => {
  afterEach(() => setTouchDevice(false))

  test("false when neither ontouchstart nor maxTouchPoints", () => {
    setTouchDevice(false)
    expect(isTouchDeviceEnvironment()).toBe(false)
  })

  test("true when ontouchstart present (mobile Safari)", () => {
    Object.defineProperty(window, "ontouchstart", { configurable: true, value: null })
    expect(isTouchDeviceEnvironment()).toBe(true)
  })

  test("true when maxTouchPoints > 0 (touch laptop, iPad)", () => {
    if ("ontouchstart" in window) {
      delete (window as unknown as { ontouchstart?: unknown }).ontouchstart
    }
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 })
    expect(isTouchDeviceEnvironment()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// NOTE: "ChatInput onSelect wiring" test REMOVED
//
// The original test mounted ChatInput with a <Profiler> and fired `select` +
// `selectionchange` events on a <textarea>, asserting that a touch device
// produced zero extra React commits (no caretVersion bump → no controlled-
// textarea reconciliation).
//
// Under the Lexical editor there is no controlled textarea and no
// `caretVersion` state integer. Lexical manages its own selection state
// internally. The test's regression target no longer exists.
//
// Coverage that still applies is preserved:
//   - `shouldRefreshPickerOnSelection` exported utility (above)
//   - `isTouchDeviceEnvironment` exported utility (above)
// ---------------------------------------------------------------------------
