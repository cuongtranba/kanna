import { afterEach, describe, expect, test } from "bun:test"
import type { PluginLogEntry } from "../shared/plugins/log-ring"
import { runCli } from "./cli-runtime"
import {
  formatInstalled,
  formatPluginLogs,
  formatPluginTable,
  PLUGIN_CLI_USAGE,
  runPluginCli,
} from "./plugin-cli-dispatch"
import type { PluginService, PluginSummary } from "./plugins/plugin-service"
import { setPluginServiceForTest } from "./plugins/plugin-service-host"

interface FakePluginService {
  service: PluginService
  calls: string[]
  plugins: PluginSummary[]
  logEntries: PluginLogEntry[]
}

function createFakeService(overrides: Partial<PluginService> = {}): FakePluginService {
  const calls: string[] = []
  const plugins: PluginSummary[] = []
  const logEntries: PluginLogEntry[] = []

  const service: PluginService = {
    install: async ({ sourceDir }) => {
      calls.push(`install:${sourceDir}`)
      plugins.push({ id: "demo", sourceDir, enabled: false, state: "stopped" })
    },
    list: () => {
      calls.push("list")
      return [...plugins]
    },
    clientBundle: async () => null,
    recordClientError: () => {},
    reload: async (id) => {
      calls.push(`reload:${id}`)
    },
    setEnabled: async () => {},
    restore: () => {},
    start: async () => {},
    status: () => undefined,
    call: async () => ({ ok: false, error: "not implemented" }),
    stop: async () => {},
    logs: (id) => {
      calls.push(`logs:${id}`)
      return [...logEntries]
    },
    ...overrides,
  }

  return { service, calls, plugins, logEntries }
}

function createOutput() {
  const out = { lines: [] as string[], warnings: [] as string[] }
  return {
    out,
    io: {
      log: (message: string) => out.lines.push(message),
      warn: (message: string) => out.warnings.push(message),
    },
  }
}

function entry(at: number, stream: "out" | "err", text: string): PluginLogEntry {
  return { at, stream, text }
}

describe("runPluginCli", () => {
  test("install prints the resolved plugin id and exits 0", async () => {
    const fake = createFakeService()
    const { out, io } = createOutput()

    const code = await runPluginCli(["install", "/tmp/demo-plugin"], io, fake.service)

    expect(code).toBe(0)
    expect(out.lines).toEqual(["installed demo"])
    expect(out.warnings).toEqual([])
    expect(fake.calls).toContain("install:/tmp/demo-plugin")
  })

  test("ls prints a padded table and exits 0", async () => {
    const fake = createFakeService()
    fake.plugins.push(
      { id: "demo", sourceDir: "/tmp/demo", enabled: true, state: "running" },
      { id: "longer-id", sourceDir: "/tmp/other", enabled: false, state: "stopped" },
    )
    const { out, io } = createOutput()

    const code = await runPluginCli(["ls"], io, fake.service)

    expect(code).toBe(0)
    expect(out.lines).toEqual([
      "ID         STATE    ENABLED  SOURCE",
      "demo       running  yes      /tmp/demo",
      "longer-id  stopped  no       /tmp/other",
    ])
  })

  test("ls on an empty registry says so instead of printing a bare header", async () => {
    const fake = createFakeService()
    const { out, io } = createOutput()

    const code = await runPluginCli(["ls"], io, fake.service)

    expect(code).toBe(0)
    expect(out.lines).toEqual(["No plugins installed."])
  })

  test("reload drives the service and exits 0", async () => {
    const fake = createFakeService()
    const { out, io } = createOutput()

    const code = await runPluginCli(["reload", "demo"], io, fake.service)

    expect(code).toBe(0)
    expect(fake.calls).toContain("reload:demo")
    expect(out.lines).toEqual(["reloaded demo"])
  })

  test("logs honours the parsed --tail count", async () => {
    const fake = createFakeService()
    fake.logEntries.push(
      entry(0, "out", "first"),
      entry(1000, "out", "second"),
      entry(2000, "err", "third"),
    )
    const { out, io } = createOutput()

    const code = await runPluginCli(["logs", "demo", "--tail", "2"], io, fake.service)

    expect(code).toBe(0)
    expect(fake.calls).toContain("logs:demo")
    expect(out.lines).toEqual([
      "1970-01-01T00:00:01.000Z out second",
      "1970-01-01T00:00:02.000Z err third",
    ])
  })

  test("logs defaults to the parser's tail when --tail is absent", async () => {
    const fake = createFakeService()
    fake.logEntries.push(entry(0, "out", "only"))
    const { out, io } = createOutput()

    const code = await runPluginCli(["logs", "demo"], io, fake.service)

    expect(code).toBe(0)
    expect(out.lines).toEqual(["1970-01-01T00:00:00.000Z out only"])
  })

  test("a parse error prints the message plus usage and exits 1", async () => {
    const fake = createFakeService()
    const { out, io } = createOutput()

    const code = await runPluginCli(["nope"], io, fake.service)

    expect(code).toBe(1)
    expect(out.lines).toEqual([])
    expect(out.warnings).toEqual(["Unknown plugin subcommand: nope", PLUGIN_CLI_USAGE])
    expect(fake.calls).toEqual([])
  })

  test("a missing subcommand exits 1", async () => {
    const fake = createFakeService()
    const { out, io } = createOutput()

    const code = await runPluginCli([], io, fake.service)

    expect(code).toBe(1)
    expect(out.warnings[0]).toBe("Missing plugin subcommand")
  })

  test("a thrown service error prints a readable message, not a stack, and exits 1", async () => {
    const fake = createFakeService({
      reload: async () => {
        throw new Error('plugin "ghost" is not installed')
      },
    })
    const { out, io } = createOutput()

    const code = await runPluginCli(["reload", "ghost"], io, fake.service)

    expect(code).toBe(1)
    expect(out.lines).toEqual([])
    expect(out.warnings).toEqual(['plugin reload failed: plugin "ghost" is not installed'])
    expect(out.warnings[0]).not.toContain("at ")
  })

  test("a non-Error rejection still yields one readable line", async () => {
    // A rejected NON-Error: `errorMessage` is what keeps this from printing
    // `[object Object]` or a stack. Held in a variable so the rejection reason
    // is opaque to `prefer-promise-reject-errors` — rejecting with a literal
    // string is exactly the case under test, not a mistake to lint away.
    const nonError: unknown = "compile blew up"
    const fake = createFakeService({
      install: () => Promise.reject(nonError),
    })
    const { out, io } = createOutput()

    const code = await runPluginCli(["install", "/tmp/demo"], io, fake.service)

    expect(code).toBe(1)
    expect(out.warnings).toEqual(["plugin install failed: compile blew up"])
  })
})

describe("formatInstalled", () => {
  test("prefers the id that appeared during the install", () => {
    const before: PluginSummary[] = [{ id: "old", sourceDir: "/tmp/demo", enabled: false, state: "stopped" }]
    const after: PluginSummary[] = [
      ...before,
      { id: "fresh", sourceDir: "/tmp/demo", enabled: false, state: "stopped" },
    ]

    expect(formatInstalled(before, after, "/tmp/demo")).toBe("installed fresh")
  })

  test("falls back to the existing row when a reinstall adds no id", () => {
    const rows: PluginSummary[] = [{ id: "demo", sourceDir: "/tmp/demo", enabled: true, state: "running" }]

    expect(formatInstalled(rows, rows, "/tmp/demo")).toBe("installed demo")
  })

  test("names the directory when the registry reveals no matching row", () => {
    expect(formatInstalled([], [], "/tmp/demo")).toBe("installed plugin from /tmp/demo")
  })
})

describe("formatPluginTable", () => {
  test("leaves no trailing whitespace on the last column", () => {
    const lines = formatPluginTable([
      { id: "a", sourceDir: "/tmp/a", enabled: true, state: "running" },
      { id: "bbbb", sourceDir: "/tmp/b", enabled: false, state: "crashed" },
    ])

    for (const line of lines) expect(line).toBe(line.trimEnd())
  })
})

describe("formatPluginLogs", () => {
  test("--tail 0 prints nothing rather than the whole ring", () => {
    expect(formatPluginLogs([entry(0, "out", "a"), entry(1, "out", "b")], 0)).toEqual(["No log entries."])
  })

  test("a tail larger than the ring prints every entry", () => {
    expect(formatPluginLogs([entry(0, "out", "a")], 100)).toEqual(["1970-01-01T00:00:00.000Z out a"])
  })
})

describe("runCli plugin arm", () => {
  afterEach(() => {
    setPluginServiceForTest(null)
  })

  function createRuntimeDeps(log: string[], warn: string[]): Parameters<typeof runCli>[1] {
    return {
      version: "0.0.0",
      bunVersion: "1.3.11",
      startServer: async () => {
        throw new Error("plugin subcommand must not start the server")
      },
      fetchLatestVersion: async () => {
        throw new Error("plugin subcommand must not check for updates")
      },
      installVersion: () => {
        throw new Error("plugin subcommand must not self-update")
      },
      openUrl: () => {
        throw new Error("plugin subcommand must not open a browser")
      },
      log: (message) => log.push(message),
      warn: (message) => warn.push(message),
      // The suite installs its own service via `setPluginServiceForTest`; the
      // real boot step would replace it with one backed by the real settings.json.
      preparePluginService: async () => {},
    }
  }

  test("routes `plugin ls` into the process-wide service and exits 0", async () => {
    const fake = createFakeService()
    fake.plugins.push({ id: "demo", sourceDir: "/tmp/demo", enabled: true, state: "running" })
    setPluginServiceForTest(fake.service)
    const log: string[] = []
    const warn: string[] = []

    const result = await runCli(["plugin", "ls"], createRuntimeDeps(log, warn))

    expect(result).toEqual({ kind: "exited", code: 0 })
    expect(log).toEqual([
      "ID    STATE    ENABLED  SOURCE",
      "demo  running  yes      /tmp/demo",
    ])
  })

  test("a bad plugin subcommand exits non-zero without starting the server", async () => {
    setPluginServiceForTest(createFakeService().service)
    const log: string[] = []
    const warn: string[] = []

    const result = await runCli(["plugin", "wat"], createRuntimeDeps(log, warn))

    expect(result).toEqual({ kind: "exited", code: 1 })
    expect(warn[0]).toBe("Unknown plugin subcommand: wat")
  })

  test("an old Bun does not block a plugin subcommand", async () => {
    setPluginServiceForTest(createFakeService().service)
    const log: string[] = []
    const warn: string[] = []
    const deps = { ...createRuntimeDeps(log, warn), bunVersion: "1.0.0" }

    const result = await runCli(["plugin", "ls"], deps)

    expect(result).toEqual({ kind: "exited", code: 0 })
    expect(warn).toEqual([])
  })
})
