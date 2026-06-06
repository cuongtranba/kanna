import { describe, expect, test } from "bun:test"
import { parseTuiStatusLine } from "./tui-status-line"

describe("parseTuiStatusLine", () => {
  test("parses verb, elapsed, tokens, and thinking-effort phrase", () => {
    const line = "✻ Whirlpooling… (11m 11s · ↓ 40.5k tokens · almost done thinking with xhigh effort)"
    const status = parseTuiStatusLine(line)
    expect(status).not.toBeNull()
    expect(status?.verb).toBe("Whirlpooling")
    expect(status?.elapsedSeconds).toBe(671)
    expect(status?.tokens).toBe(40500)
    expect(status?.effort).toBe("almost done thinking with xhigh effort")
    expect(status?.raw).toBe("Whirlpooling… (11m 11s · ↓ 40.5k tokens · almost done thinking with xhigh effort)")
  })

  test("strips ANSI escape codes and uses the LAST redraw in the ring", () => {
    const ring =
      "\x1b[2K\r✻ Whirlpooling… (3s · ↓ 1.2k tokens · esc to interrupt)" +
      "\x1b[2K\r\x1b[38;5;213m✶ Whirlpooling… (11m 11s · ↓ 40.5k tokens · almost done thinking with xhigh effort)\x1b[0m"
    const status = parseTuiStatusLine(ring)
    expect(status?.elapsedSeconds).toBe(671)
    expect(status?.tokens).toBe(40500)
    expect(status?.effort).toBe("almost done thinking with xhigh effort")
  })

  test("parses seconds-only elapsed and esc-to-interrupt trailing segment", () => {
    const status = parseTuiStatusLine("✶ Forging… (45s · ↓ 980 tokens · esc to interrupt)")
    expect(status?.verb).toBe("Forging")
    expect(status?.elapsedSeconds).toBe(45)
    expect(status?.tokens).toBe(980)
    expect(status?.effort).toBe("esc to interrupt")
  })

  test("parses hours in elapsed", () => {
    const status = parseTuiStatusLine("✻ Pondering… (1h 5m · ↓ 2.0k tokens · esc to interrupt)")
    expect(status?.elapsedSeconds).toBe(3900)
  })

  test("returns null on empty / non-matching output (drift tolerance)", () => {
    expect(parseTuiStatusLine("")).toBeNull()
    expect(parseTuiStatusLine("just some normal terminal output\nno spinner here")).toBeNull()
    expect(parseTuiStatusLine("\x1b[2K\r❯ ")).toBeNull()
  })

  test("tolerates a missing tokens segment", () => {
    const status = parseTuiStatusLine("✻ Whirlpooling… (8s · esc to interrupt)")
    expect(status).not.toBeNull()
    expect(status?.elapsedSeconds).toBe(8)
    expect(status?.tokens).toBeNull()
    expect(status?.effort).toBe("esc to interrupt")
  })
})
