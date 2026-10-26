import { expect, test } from "bun:test"
import { summarizeChildProcesses, type ChildProcessUsage } from "./process-vitals"

const ROOT_PID = 100

const PS_OUTPUT = [
  "    1     0   9000 /sbin/launchd",
  "  100     1 500000 /usr/local/bin/bun",
  "  200   100 400000 /Users/me/.local/bin/claude",
  "  201   200 100000 node",
  "  202   200  50000 /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper",
  "  300   100  40000 nats-server",
  "  400   100   2000 bash",
  "  900     1 700000 /usr/bin/claude",
  "  901   900  30000 node",
].join("\n")

function byKind(usages: ChildProcessUsage[]): Record<string, ChildProcessUsage> {
  return Object.fromEntries(usages.map((usage) => [usage.kind, usage]))
}

test("attributes each descendant to the kind Kanna launched and leaves out the root and unrelated processes", () => {
  const totals = byKind(summarizeChildProcesses(PS_OUTPUT, ROOT_PID))

  expect(Object.keys(totals).sort()).toEqual(["claude", "nats-server", "shell"])
  expect(totals.claude).toEqual({ kind: "claude", rssBytes: (400_000 + 100_000 + 50_000) * 1024, count: 3 })
  expect(totals["nats-server"]).toEqual({ kind: "nats-server", rssBytes: 40_000 * 1024, count: 1 })
  expect(totals.shell).toEqual({ kind: "shell", rssBytes: 2_000 * 1024, count: 1 })
})

test("leaves out the processes the sampler itself launched", () => {
  const totals = byKind(summarizeChildProcesses(PS_OUTPUT, ROOT_PID, new Set([400])))

  expect(totals.shell).toBeUndefined()
  expect(totals.claude?.count).toBe(3)
})
