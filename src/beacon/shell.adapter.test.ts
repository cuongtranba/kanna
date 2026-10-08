import { describe, expect, test } from "bun:test"
import { createBeaconShell } from "./shell.adapter"

function collector() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    sink: { stdout: (chunk: string) => out.push(chunk), stderr: (chunk: string) => err.push(chunk) },
  }
}

const LIMITS = { timeoutMs: 10_000, outputByteCap: 100_000 }

describe("beacon shell adapter", () => {
  test("exec returns the program output and exit code 0", async () => {
    const { out, sink } = collector()
    const code = await createBeaconShell("linux").exec({ cmd: "echo", cmdArgs: ["hello"] }, sink, LIMITS)
    expect(code).toBe(0)
    expect(out.join("")).toBe("hello\n")
  })

  test("exec reports a non-zero exit code", async () => {
    const { sink } = collector()
    const code = await createBeaconShell("linux").exec({ cmd: "sh", cmdArgs: ["-c", "exit 3"] }, sink, LIMITS)
    expect(code).toBe(3)
  })

  test("kills a command that outlives the timeout", async () => {
    const { sink } = collector()
    const code = await createBeaconShell("linux").exec(
      { cmd: "sleep", cmdArgs: ["30"] },
      sink,
      { timeoutMs: 100, outputByteCap: 1000 },
    )
    expect(code).not.toBe(0)
  })

  test("truncates output beyond the byte cap", async () => {
    const { out, err, sink } = collector()
    await createBeaconShell("linux").script("yes abcdefghij | head -c 5000", sink, {
      timeoutMs: 10_000,
      outputByteCap: 100,
    })
    expect(Buffer.byteLength(out.join(""))).toBe(100)
    expect(err.join("")).toContain("truncated")
  })

  test("script runs through the login shell", async () => {
    const { out, sink } = collector()
    const code = await createBeaconShell("linux").script("echo $((1+2))", sink, LIMITS)
    expect(code).toBe(0)
    expect(out.join("")).toBe("3\n")
  })
})
