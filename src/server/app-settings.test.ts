import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AUTH_DEFAULTS, CLAUDE_AUTH_DEFAULTS, CLOUDFLARE_TUNNEL_DEFAULTS, UPLOAD_DEFAULTS } from "../shared/types"
import { AppSettingsManager, readAppSettingsSnapshot } from "./app-settings"
import type { AppSettingsSnapshot } from "../shared/types"

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

async function createTempFilePath() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-settings-"))
  tempDirs.push(dir)
  return path.join(dir, "settings.json")
}

async function writeSettingsFile(content: Record<string, unknown>) {
  const filePath = await createTempFilePath()
  await writeFile(filePath, JSON.stringify(content), "utf8")
  return filePath
}

function expectedSettingsSnapshot(filePath: string, overrides: Partial<AppSettingsSnapshot> = {}): AppSettingsSnapshot {
  return {
    analyticsEnabled: true,
    browserSettingsMigrated: false,
    theme: "system",
    chatSoundPreference: "always",
    chatSoundId: "funk",
    terminal: {
      scrollbackLines: 1_000,
      minColumnWidth: 450,
    },
    editor: {
      preset: "cursor",
      commandTemplate: "cursor {path}",
    },
    defaultProvider: "last_used",
    providerDefaults: {
      claude: {
        model: "claude-opus-4-7",
        modelOptions: {
          reasoningEffort: "high",
          contextWindow: "200k",
        },
        planMode: false,
      },
      codex: {
        model: "gpt-5.5",
        modelOptions: {
          reasoningEffort: "high",
          fastMode: false,
        },
        planMode: false,
      },
    },
    warning: null,
    filePathDisplay: filePath,
    cloudflareTunnel: CLOUDFLARE_TUNNEL_DEFAULTS,
    auth: AUTH_DEFAULTS,
    claudeAuth: CLAUDE_AUTH_DEFAULTS,
    uploads: UPLOAD_DEFAULTS,
    ...overrides,
  }
}

describe("readAppSettingsSnapshot", () => {
  test("returns defaults when the file does not exist", async () => {
    const filePath = await createTempFilePath()
    const snapshot = await readAppSettingsSnapshot(filePath)

    expect(snapshot).toEqual(expectedSettingsSnapshot(filePath))
  })

  test("returns a warning when the file contains invalid json", async () => {
    const filePath = await createTempFilePath()
    await writeFile(filePath, "{not-json", "utf8")

    const snapshot = await readAppSettingsSnapshot(filePath)
    expect(snapshot.analyticsEnabled).toBe(true)
    expect(snapshot.warning).toContain("invalid JSON")
  })
})

describe("AppSettingsManager", () => {
  test("creates a settings file with analytics enabled and a stable anonymous id", async () => {
    const filePath = await createTempFilePath()
    const manager = new AppSettingsManager(filePath)

    await manager.initialize()

    const payload = JSON.parse(await readFile(filePath, "utf8")) as {
      analyticsEnabled: boolean
      analyticsUserId: string
    }
    expect(payload.analyticsEnabled).toBe(true)
    expect(payload.analyticsUserId).toMatch(/^anon_/)
    expect(manager.getSnapshot()).toEqual(expectedSettingsSnapshot(filePath))

    manager.dispose()
  })

  test("writes analyticsEnabled without replacing the stored user id", async () => {
    const filePath = await createTempFilePath()
    const manager = new AppSettingsManager(filePath)

    await manager.initialize()
    const initialPayload = JSON.parse(await readFile(filePath, "utf8")) as {
      analyticsEnabled: boolean
      analyticsUserId: string
    }

    const snapshot = await manager.write({ analyticsEnabled: false })
    const nextPayload = JSON.parse(await readFile(filePath, "utf8")) as {
      analyticsEnabled: boolean
      analyticsUserId: string
    }

    expect(snapshot).toEqual(expectedSettingsSnapshot(filePath, { analyticsEnabled: false }))
    expect(nextPayload.analyticsEnabled).toBe(false)
    expect(nextPayload.analyticsUserId).toBe(initialPayload.analyticsUserId)

    manager.dispose()
  })

  test("patches expanded settings without replacing the stored user id", async () => {
    const filePath = await createTempFilePath()
    const manager = new AppSettingsManager(filePath)

    await manager.initialize()
    const initialPayload = JSON.parse(await readFile(filePath, "utf8")) as {
      analyticsUserId: string
    }

    const snapshot = await manager.writePatch({
      theme: "dark",
      chatSoundId: "glass",
      terminal: { scrollbackLines: 2_500 },
      editor: { preset: "vscode" },
      providerDefaults: {
        codex: {
          modelOptions: { reasoningEffort: "high", fastMode: true },
        },
      },
    })
    const nextPayload = JSON.parse(await readFile(filePath, "utf8")) as {
      analyticsUserId: string
      theme: string
      chatSoundId: string
      terminal: { scrollbackLines: number; minColumnWidth: number }
      editor: { preset: string; commandTemplate: string }
      providerDefaults: { codex: { modelOptions: { fastMode: boolean } } }
    }

    expect(snapshot.theme).toBe("dark")
    expect(snapshot.chatSoundId).toBe("glass")
    expect(snapshot.terminal.scrollbackLines).toBe(2_500)
    expect(snapshot.terminal.minColumnWidth).toBe(450)
    expect(snapshot.editor.preset).toBe("vscode")
    expect(snapshot.editor.commandTemplate).toBe("cursor {path}")
    expect(snapshot.providerDefaults.codex.modelOptions.fastMode).toBe(true)
    expect(nextPayload.analyticsUserId).toBe(initialPayload.analyticsUserId)
    expect(nextPayload.theme).toBe("dark")
    expect(nextPayload.chatSoundId).toBe("glass")

    manager.dispose()
  })
})

describe("cloudflareTunnel normalization", () => {
  test("normalizes missing cloudflareTunnel block to defaults", async () => {
    const filePath = await writeSettingsFile({ analyticsEnabled: true })
    const snapshot = await readAppSettingsSnapshot(filePath)
    expect(snapshot.cloudflareTunnel).toEqual({
      enabled: false,
      cloudflaredPath: "cloudflared",
      mode: "always-ask",
    })
  })

  test("preserves valid cloudflareTunnel settings", async () => {
    const filePath = await writeSettingsFile({
      cloudflareTunnel: { enabled: true, cloudflaredPath: "/usr/local/bin/cloudflared", mode: "auto-expose" },
    })
    const snapshot = await readAppSettingsSnapshot(filePath)
    expect(snapshot.cloudflareTunnel).toEqual({
      enabled: true,
      cloudflaredPath: "/usr/local/bin/cloudflared",
      mode: "auto-expose",
    })
  })

  test("rejects invalid mode and resets to default with warning", async () => {
    const filePath = await writeSettingsFile({
      cloudflareTunnel: { enabled: true, cloudflaredPath: "cloudflared", mode: "garbage" },
    })
    const snapshot = await readAppSettingsSnapshot(filePath)
    expect(snapshot.cloudflareTunnel.mode).toBe("always-ask")
    expect(snapshot.warning).toContain("cloudflareTunnel.mode")
  })

  test("setCloudflareTunnel persists patch to disk and round-trips through readAppSettingsSnapshot", async () => {
    const filePath = await writeSettingsFile({ analyticsEnabled: true })
    const manager = new AppSettingsManager(filePath)
    await manager.initialize()
    await manager.setCloudflareTunnel({ enabled: true, mode: "auto-expose" })
    const reloaded = await readAppSettingsSnapshot(filePath)
    expect(reloaded.cloudflareTunnel).toEqual({
      enabled: true,
      cloudflaredPath: "cloudflared",
      mode: "auto-expose",
    })
  })

  test("write() preserves cloudflareTunnel across analytics-only updates", async () => {
    const filePath = await writeSettingsFile({
      analyticsEnabled: true,
      cloudflareTunnel: { enabled: true, cloudflaredPath: "/opt/cloudflared", mode: "auto-expose" },
    })
    const manager = new AppSettingsManager(filePath)
    await manager.initialize()
    // Simulate analytics toggle — must NOT erase tunnel block
    await manager.write({ analyticsEnabled: false })
    const reloaded = await readAppSettingsSnapshot(filePath)
    expect(reloaded.cloudflareTunnel).toEqual({
      enabled: true,
      cloudflaredPath: "/opt/cloudflared",
      mode: "auto-expose",
    })
  })
})

describe("uploads normalization", () => {
  test("returns defaults when uploads block missing", async () => {
    const filePath = await writeSettingsFile({ analyticsEnabled: true })
    const snapshot = await readAppSettingsSnapshot(filePath)
    expect(snapshot.uploads).toEqual({ maxFileSizeMb: 100 })
  })

  test("preserves valid maxFileSizeMb", async () => {
    const filePath = await writeSettingsFile({ uploads: { maxFileSizeMb: 250 } })
    const snapshot = await readAppSettingsSnapshot(filePath)
    expect(snapshot.uploads.maxFileSizeMb).toBe(250)
  })

  test("clamps out-of-range values and emits warning", async () => {
    const filePath = await writeSettingsFile({ uploads: { maxFileSizeMb: 99999 } })
    const snapshot = await readAppSettingsSnapshot(filePath)
    expect(snapshot.uploads.maxFileSizeMb).toBe(2048)
    expect(snapshot.warning).toContain("uploads.maxFileSizeMb")
  })

  test("rejects non-number maxFileSizeMb and falls back to default", async () => {
    const filePath = await writeSettingsFile({ uploads: { maxFileSizeMb: "big" } })
    const snapshot = await readAppSettingsSnapshot(filePath)
    expect(snapshot.uploads.maxFileSizeMb).toBe(100)
    expect(snapshot.warning).toContain("uploads.maxFileSizeMb must be a number")
  })

  test("setUploads persists patch and round-trips through readAppSettingsSnapshot", async () => {
    const filePath = await writeSettingsFile({ analyticsEnabled: true })
    const manager = new AppSettingsManager(filePath)
    await manager.initialize()
    await manager.setUploads({ maxFileSizeMb: 500 })
    const reloaded = await readAppSettingsSnapshot(filePath)
    expect(reloaded.uploads.maxFileSizeMb).toBe(500)
    manager.dispose()
  })

  test("setUploads throws on invalid value", async () => {
    const filePath = await createTempFilePath()
    const manager = new AppSettingsManager(filePath)
    await manager.initialize()
    let lowError: unknown
    try { await manager.setUploads({ maxFileSizeMb: 0 }) } catch (error) { lowError = error }
    expect((lowError as Error)?.message).toMatch(/between/)
    let highError: unknown
    try { await manager.setUploads({ maxFileSizeMb: 99999 }) } catch (error) { highError = error }
    expect((highError as Error)?.message).toMatch(/between/)
    manager.dispose()
  })
})

describe("AppSettingsManager.setClaudeAuth", () => {
  test("persists tokens and round-trips", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-settings-"))
    const filePath = path.join(dir, "settings.json")
    const mgr = new AppSettingsManager(filePath)
    await mgr.initialize()

    const snapshot = await mgr.setClaudeAuth({
      tokens: [{
        id: "t1", label: "prod", token: "sk-ant-abc",
        status: "active", limitedUntil: null,
        lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 100,
      }],
    })
    expect(snapshot.claudeAuth.tokens).toHaveLength(1)
    expect(snapshot.claudeAuth.tokens[0]?.label).toBe("prod")

    const raw = JSON.parse(await readFile(filePath, "utf8"))
    expect(raw.claudeAuth.tokens[0].token).toBe("sk-ant-abc")

    mgr.dispose()
  })

  test("mutateTokenStatus updates one field without disturbing others", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-settings-"))
    const filePath = path.join(dir, "settings.json")
    const mgr = new AppSettingsManager(filePath)
    await mgr.initialize()

    await mgr.setClaudeAuth({
      tokens: [{
        id: "t1", label: "prod", token: "sk-ant-abc",
        status: "active", limitedUntil: null,
        lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 100,
      }],
    })
    await mgr.mutateTokenStatus("t1", { status: "limited", limitedUntil: 9999 })
    const snapshot = mgr.getSnapshot()
    expect(snapshot.claudeAuth.tokens[0]?.status).toBe("limited")
    expect(snapshot.claudeAuth.tokens[0]?.limitedUntil).toBe(9999)
    expect(snapshot.claudeAuth.tokens[0]?.token).toBe("sk-ant-abc")

    mgr.dispose()
  })

  test("reload race with partial JSON does not clobber in-memory tokens", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-settings-"))
    const filePath = path.join(dir, "settings.json")
    const mgr = new AppSettingsManager(filePath)
    await mgr.initialize()

    await mgr.setClaudeAuth({
      tokens: [{
        id: "t1", label: "prod", token: "sk-ant-abc",
        status: "active", limitedUntil: null,
        lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 100,
      }],
    })

    // Simulate the watcher reading the file mid-write: file briefly contains
    // truncated/partial JSON that JSON.parse rejects.
    await writeFile(filePath, "{ \"claudeAuth\": { \"tokens\":", "utf8")

    let caught: unknown = null
    try {
      await mgr.reload()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SyntaxError)

    // In-memory state must still hold the token; otherwise the next
    // mutateTokenStatus would persist an empty token list and drop OAuth keys
    // permanently.
    expect(mgr.getSnapshot().claudeAuth.tokens).toHaveLength(1)
    expect(mgr.getSnapshot().claudeAuth.tokens[0]?.token).toBe("sk-ant-abc")

    mgr.dispose()
  })

  test("writes are atomic — no observer ever sees an empty/partial file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-settings-"))
    const filePath = path.join(dir, "settings.json")
    const mgr = new AppSettingsManager(filePath)
    await mgr.initialize()

    // Seed initial tokens.
    await mgr.setClaudeAuth({
      tokens: [{
        id: "t1", label: "prod", token: "sk-ant-abc",
        status: "active", limitedUntil: null,
        lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 100,
      }],
    })

    // Race many mutateTokenStatus writes against repeated full-file reads.
    // Every read must parse to valid JSON with the token present.
    let stop = false
    const reader = (async () => {
      while (!stop) {
        try {
          const text = await readFile(filePath, "utf8")
          const parsed = JSON.parse(text)
          expect(parsed.claudeAuth.tokens[0]?.token).toBe("sk-ant-abc")
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code === "ENOENT") continue
          throw err
        }
      }
    })()

    for (let i = 0; i < 50; i++) {
      await mgr.mutateTokenStatus("t1", { lastUsedAt: i })
    }
    stop = true
    await reader

    expect(mgr.getSnapshot().claudeAuth.tokens[0]?.token).toBe("sk-ant-abc")
    mgr.dispose()
  })
})

