import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startClaudeSessionPTY, buildPtyCliArgs, resolveSpawnSessionId, OutputRing, PTY_STDERR_RING_BYTES, PTY_DISALLOWED_NATIVE_TOOLS, deriveAccountInfoFromOauth, PLAN_MODE_EXIT_UNSUPPORTED, SHIFT_TAB_KEY, buildChannelPromptFraming } from "./driver"
import type { TranscriptStream } from "./tui-source.adapter"
import type { PtyProcess, SpawnPtyProcessArgs } from "./pty-process.adapter"
import { KANNA_SYSTEM_PROMPT_APPEND } from "../../shared/kanna-system-prompt"
import type { HarnessEvent } from "../harness-types"
import { readAppSettingsSnapshot } from "../app-settings"
import type { McpServerConfig } from "../../shared/types"



describe("resolveSpawnSessionId", () => {
  test("resume reuses the session token as the session id", () => {
    expect(resolveSpawnSessionId({ sessionToken: "tok-abc", forkSession: false }, () => "fresh")).toBe("tok-abc")
  })

  test("new session (no token) gets a fresh id", () => {
    expect(resolveSpawnSessionId({ sessionToken: null, forkSession: false }, () => "fresh")).toBe("fresh")
  })

  test("fork gets a fresh id distinct from the source token (collision would make claude refuse the fork)", () => {
    expect(resolveSpawnSessionId({ sessionToken: "old-tok", forkSession: true }, () => "fresh")).toBe("fresh")
    expect(resolveSpawnSessionId({ sessionToken: "old-tok", forkSession: true }, () => "fresh")).not.toBe("old-tok")
  })
})

describe("startClaudeSessionPTY", () => {
  test("auth precheck fails when credentials missing", async () => {
    if (process.platform === "win32") return
    const homeDir = await mkdtemp(path.join(tmpdir(), "kanna-pty-driver-"))
    try {
      let err: unknown
      try {
        await startClaudeSessionPTY({
          chatId: "c",
          projectId: "p",
          localPath: "/tmp",
          model: "claude-sonnet-4-6",
          planMode: false,
          forkSession: false,
          oauthToken: null,
          sessionToken: null,
          onToolRequest: async () => null,
          homeDir,
          env: {},
        })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/OAuth pool token/)
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  })



  test.skipIf(process.env.KANNA_PTY_E2E !== "1")(
    "E2E: spawn claude, send one prompt, observe one transcript event",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "kanna-pty-e2e-"))
      try {
        const handle = await startClaudeSessionPTY({
          chatId: "e2e",
          projectId: "e2e",
          localPath: dir,
          model: "claude-haiku-4-5-20251001",
          planMode: false,
          forkSession: false,
          oauthToken: null,
          sessionToken: null,
          onToolRequest: async () => null,
        })
        await handle.sendPrompt("Reply with exactly the word: ok")
        const it = handle.stream[Symbol.asyncIterator]()
        const start = Date.now()
        let sawTranscript = false
        while (Date.now() - start < 30_000) {
          const next = await Promise.race([
            it.next(),
            new Promise<IteratorResult<HarnessEvent>>((r) =>
              setTimeout(() => r({ value: undefined as unknown as HarnessEvent, done: false }), 500),
            ),
          ])
          if (next.value?.type === "transcript") {
            sawTranscript = true
            break
          }
        }
        expect(sawTranscript).toBe(true)
        handle.close()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
    60_000,
  )

  test.skipIf(process.env.KANNA_PTY_E2E !== "1")(
    "E2E: setPermissionMode(true/false) — plan mode enter via /plan, exit via Shift+Tab",
    async () => {
      if (process.platform === "win32") return
      const settings = await readAppSettingsSnapshot()
      const activeEntry = settings.claudeAuth.tokens.find((t) => t.status === "active")
      if (!activeEntry) {
        console.warn("[e2e] no active OAuth token in Kanna settings — skipping plan-mode E2E")
        return
      }
      const dir = await mkdtemp(path.join(tmpdir(), "kanna-pty-pm-e2e-"))
      try {
        const handle = await startClaudeSessionPTY({
          chatId: "e2e-pm", projectId: "e2e-pm", localPath: dir,
          model: "claude-haiku-4-5-20251001",
          planMode: false, forkSession: false,
          oauthToken: activeEntry.token,
          sessionToken: null,
          onToolRequest: async () => null,
        })
        try {
          const iter = handle.stream[Symbol.asyncIterator]()

          async function awaitResult(label: string, timeoutMs = 30_000) {
            const deadline = Date.now() + timeoutMs
            while (Date.now() < deadline) {
              const next = await Promise.race([
                iter.next(),
                new Promise<IteratorResult<HarnessEvent>>((r) =>
                  setTimeout(() => r({ value: undefined as unknown as HarnessEvent, done: false }), 500),
                ),
              ])
              const ev = next.value as HarnessEvent | undefined
              if (ev?.type === "transcript"
                && (ev.entry as { kind?: string } | undefined)?.kind === "result") {
                return true
              }
            }
            throw new Error(`${label}: timed out waiting for result entry`)
          }

          await handle.setPermissionMode(true)
          await new Promise((r) => setTimeout(r, 800))

          await handle.sendPrompt("Reply with exactly the word: plantest")
          await awaitResult("plan-mode prompt")

          await handle.setPermissionMode(false)
          await new Promise((r) => setTimeout(r, 800))

          await handle.sendPrompt("Reply with exactly the word: normaltest")
          await awaitResult("post-shift-tab prompt")
        } finally {
          handle.close()
        }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
    90_000,
  )

})

describe("startClaudeSessionPTY smoke-test gate", () => {
  test("refuses spawn when gate returns ok:false", async () => {
    const failingGate: import("./smoke-test").SmokeTestGate = {
      async canSpawn() { return { ok: false, reason: "disallowedTools regression" } },
    }
    await expect(startClaudeSessionPTY({
      chatId: "c1", projectId: "p1", localPath: "/tmp",
      model: "claude-opus-4-7", planMode: false, forkSession: false,
      oauthToken: "test-token", sessionToken: null,
      onToolRequest: async () => null,
      smokeTestGate: failingGate,
      env: { HOME: "/tmp", CLAUDE_CODE_OAUTH_TOKEN: "test-token" },
    })).rejects.toThrow(/smoke-test refused/i)
  })
})


describe("buildPtyCliArgs TUI mode", () => {
  test("does NOT include --print", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "m", planMode: false,
      sessionToken: null, forkSession: false,
    })
    expect(args).not.toContain("--print")
  })

  test("does NOT include --output-format / --input-format / --verbose", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "m", planMode: false,
      sessionToken: null, forkSession: false,
    })
    expect(args.find((a) => a.startsWith("--output-format"))).toBeUndefined()
    expect(args.find((a) => a.startsWith("--input-format"))).toBeUndefined()
    expect(args).not.toContain("--verbose")
  })

  test("includes core TUI args", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "claude-opus-4-7", planMode: false,
      sessionToken: null, forkSession: false,
    })
    expect(args).toContain("--model")
    expect(args).toContain("claude-opus-4-7")
    expect(args).toContain("--permission-mode")
    expect(args).toContain("acceptEdits")
    expect(args).toContain("--dangerously-skip-permissions")
  })

  test("new sessions omit --session-id (interactive TUI ignores it; mtime filter handles JSONL discovery)", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "m", planMode: false,
      sessionToken: null, forkSession: false,
    })
    expect(args).not.toContain("--session-id")
    expect(args).not.toContain("--resume")
  })

  test("resume passes --resume <token> without --session-id", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "m", planMode: false,
      sessionToken: "tok-abc", forkSession: false,
    })
    expect(args).toContain("--resume")
    expect(args).toContain("tok-abc")
    expect(args).not.toContain("--session-id")
    expect(args).not.toContain("--fork-session")
  })

  test("fork passes --session-id + --resume + --fork-session", () => {
    const args = buildPtyCliArgs({
      sessionId: "fork-uuid", model: "m", planMode: false,
      sessionToken: "old-tok", forkSession: true,
    })
    expect(args).toContain("--session-id")
    expect(args).toContain("fork-uuid")
    expect(args).toContain("--resume")
    expect(args).toContain("old-tok")
    expect(args).toContain("--fork-session")
  })

  test("plan mode uses plan permission mode", () => {
    const args = buildPtyCliArgs({
      sessionId: "s1", model: "m", planMode: true,
      sessionToken: null, forkSession: false,
    })
    expect(args).toContain("plan")
  })
})

describe("buildPtyCliArgs", () => {
  const baseInput = {
    sessionId: "sess-123",
    model: "claude-sonnet-4-6",
    planMode: false,
    sessionToken: null,
    forkSession: false,
  }

  test("emits required base flags", () => {
    const args = buildPtyCliArgs(baseInput)
    expect(args).toContain("--model")
    expect(args).toContain("claude-sonnet-4-6")
    expect(args).not.toContain("--no-update")
    expect(args).toContain("--permission-mode")
    expect(args).toContain("acceptEdits")
  })

  test("does NOT restrict tools — model uses claude built-ins", () => {
    const args = buildPtyCliArgs(baseInput)
    expect(args).not.toContain("--tools")
    expect(args).not.toContain("mcp__kanna__*")
  })

  test("loads user/project/local setting sources (no --settings override)", () => {
    const args = buildPtyCliArgs(baseInput)
    expect(args).not.toContain("--settings")
    const idx = args.indexOf("--setting-sources")
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe("user,project,local")
  })

  test("emits --dangerously-skip-permissions (personal-use bypass)", () => {
    const args = buildPtyCliArgs(baseInput)
    expect(args).toContain("--dangerously-skip-permissions")
  })

  test("plan mode picks 'plan' permission", () => {
    const args = buildPtyCliArgs({ ...baseInput, planMode: true })
    const idx = args.indexOf("--permission-mode")
    expect(args[idx + 1]).toBe("plan")
  })

  test("--effort omitted when undefined", () => {
    const args = buildPtyCliArgs(baseInput)
    expect(args).not.toContain("--effort")
  })

  test("--effort omitted when empty string", () => {
    const args = buildPtyCliArgs({ ...baseInput, effort: "" })
    expect(args).not.toContain("--effort")
  })

  test("--effort appended when provided", () => {
    const args = buildPtyCliArgs({ ...baseInput, effort: "high" })
    const idx = args.indexOf("--effort")
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe("high")
  })

  test("resume mode: --resume only, no --session-id (claude rejects both together)", () => {
    const args = buildPtyCliArgs({ ...baseInput, sessionToken: "tok-abc" })
    expect(args).not.toContain("--session-id")
    expect(args).not.toContain("--fork-session")
    const idx = args.indexOf("--resume")
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe("tok-abc")
  })

  test("new-session mode (no token, no fork): no --session-id, no --resume, no --fork-session", () => {
    const args = buildPtyCliArgs(baseInput)
    expect(args).not.toContain("--resume")
    expect(args).not.toContain("--fork-session")
    expect(args).not.toContain("--session-id")
  })

  test("fork mode: --session-id + --resume + --fork-session all three", () => {
    const args = buildPtyCliArgs({ ...baseInput, sessionToken: "tok-abc", forkSession: true })
    expect(args).toContain("--fork-session")
    const sid = args.indexOf("--session-id")
    expect(sid).toBeGreaterThan(-1)
    expect(args[sid + 1]).toBe("sess-123")
    const resume = args.indexOf("--resume")
    expect(resume).toBeGreaterThan(-1)
    expect(args[resume + 1]).toBe("tok-abc")
  })

  test("--add-dir per additional directory", () => {
    const args = buildPtyCliArgs({ ...baseInput, additionalDirectories: ["/a", "/b"] })
    const addDirs = args.reduce<string[]>((acc, val, i) => {
      if (val === "--add-dir") acc.push(args[i + 1])
      return acc
    }, [])
    expect(addDirs).toEqual(["/a", "/b"])
  })

  test("default appended kanna system prompt when no override", () => {
    const args = buildPtyCliArgs(baseInput)
    const idx = args.indexOf("--append-system-prompt")
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toContain("Kanna coding agent")
  })

  test("D8: appended prompt is the shared KANNA_SYSTEM_PROMPT_APPEND when no override is supplied", () => {
    const args = buildPtyCliArgs(baseInput)
    const idx = args.indexOf("--append-system-prompt")
    expect(args[idx + 1]).toBe(KANNA_SYSTEM_PROMPT_APPEND)
    expect(args[idx + 1]).toContain("Reverse-engineering, security research")
  })

  test("D8b: systemPromptAppend overrides the static default (dynamic subagent roster path)", () => {
    const dynamic = `${KANNA_SYSTEM_PROMPT_APPEND}\n\n## Available subagents\n\n- codereview [id=sa-1]: review PR diffs`
    const args = buildPtyCliArgs({ ...baseInput, systemPromptAppend: dynamic })
    const idx = args.indexOf("--append-system-prompt")
    expect(args[idx + 1]).toBe(dynamic)
    expect(args[idx + 1]).toContain("Available subagents")
    expect(args[idx + 1]).toContain("codereview [id=sa-1]")
  })

  test("--system-prompt override replaces default append", () => {
    const args = buildPtyCliArgs({ ...baseInput, systemPromptOverride: "custom prompt body" })
    expect(args).not.toContain("--append-system-prompt")
    const idx = args.indexOf("--system-prompt")
    expect(args[idx + 1]).toBe("custom prompt body")
  })

  test("--mcp-config appended WITH --strict-mcp-config (TUI mode: strict so CLI ignores user MCP config)", () => {
    const args = buildPtyCliArgs({ ...baseInput, mcpConfigPath: "/tmp/mcp-config.json" })
    const idx = args.indexOf("--mcp-config")
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe("/tmp/mcp-config.json")
    expect(args).toContain("--strict-mcp-config")
  })

  test("--mcp-config omitted when path absent", () => {
    const args = buildPtyCliArgs(baseInput)
    expect(args).not.toContain("--mcp-config")
  })


  test("disallows native AskUserQuestion + ExitPlanMode + ScheduleWakeup (shims for AQ/EPM; no shim for ScheduleWakeup — hard-break per adr-20260711-notification-driven-loop-orchestration)", () => {
    const args = buildPtyCliArgs(baseInput)
    const idx = args.indexOf("--disallowedTools")
    expect(idx).toBeGreaterThan(-1)
    expect(args.slice(idx + 1)).toEqual(["AskUserQuestion", "ExitPlanMode", "ScheduleWakeup"])
    expect(PTY_DISALLOWED_NATIVE_TOOLS).toEqual(["AskUserQuestion", "ExitPlanMode", "ScheduleWakeup"])
    expect(args).not.toContain("EnterPlanMode")
  })

  test("--disallowedTools is last so its variadic args cannot swallow another flag", () => {
    const args = buildPtyCliArgs({ ...baseInput, mcpConfigPath: "/tmp/mcp-config.json" })
    const idx = args.indexOf("--disallowedTools")
    expect(idx).toBe(args.length - PTY_DISALLOWED_NATIVE_TOOLS.length - 1)
  })

  test("loopArmed adds Edit/Write/MultiEdit/NotebookEdit/Task to --disallowedTools", () => {
    const args = buildPtyCliArgs({ ...baseInput, loopArmed: true })
    const idx = args.indexOf("--disallowedTools")
    const disallowed = args.slice(idx + 1)
    for (const t of ["Edit", "Write", "MultiEdit", "NotebookEdit", "Task"]) {
      expect(disallowed).toContain(t)
    }
    expect(disallowed).toContain("AskUserQuestion")
  })

  test("loopArmed=false leaves the base disallow list untouched", () => {
    const args = buildPtyCliArgs({ ...baseInput, loopArmed: false })
    const idx = args.indexOf("--disallowedTools")
    expect(args.slice(idx + 1)).toEqual(["AskUserQuestion", "ExitPlanMode", "ScheduleWakeup"])
  })

  test("--disallowedTools coexists with --append-system-prompt (index assertion still holds)", () => {
    const args = buildPtyCliArgs(baseInput)
    const idx = args.indexOf("--append-system-prompt")
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe(KANNA_SYSTEM_PROMPT_APPEND)
    expect(args).toContain("--disallowedTools")
  })

  test("adds --dangerously-load-development-channels server:<name> when channelServerName set", () => {
    const args = buildPtyCliArgs({ ...baseInput, channelServerName: "kanna" })
    const i = args.indexOf("--dangerously-load-development-channels")
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe("server:kanna")
  })

  test("omits the dev-channels flag when channelServerName absent", () => {
    const args = buildPtyCliArgs(baseInput)
    expect(args).not.toContain("--dangerously-load-development-channels")
  })
})

describe("OutputRing (B4 stderr ring buffer)", () => {
  test("retains short content verbatim", () => {
    const ring = new OutputRing()
    ring.append("hello ")
    ring.append("world")
    expect(ring.tail()).toBe("hello world")
  })

  test("caps at PTY_STDERR_RING_BYTES, keeping the most recent tail", () => {
    const ring = new OutputRing()
    const big = "A".repeat(PTY_STDERR_RING_BYTES)
    ring.append(big)
    ring.append("TAIL_MARKER")
    const tail = ring.tail()
    expect(tail.length).toBe(PTY_STDERR_RING_BYTES)
    expect(tail.endsWith("TAIL_MARKER")).toBe(true)
    expect(tail.startsWith("A")).toBe(true)
    expect(tail).not.toBe(big)
  })

  test("ring size constant is 256 KB", () => {
    expect(PTY_STDERR_RING_BYTES).toBe(256 * 1024)
  })

  test("empty ring tail is empty string", () => {
    expect(new OutputRing().tail()).toBe("")
  })
})

describe("deriveAccountInfoFromOauth (C1)", () => {
  test("no label and no masked key → null (UI falls back, no bogus chip)", () => {
    expect(deriveAccountInfoFromOauth({})).toBeNull()
  })

  test("empty label and empty masked → null", () => {
    expect(deriveAccountInfoFromOauth({ label: "", oauthKeyMasked: "" })).toBeNull()
  })

  test("label only → AccountInfo with organization + kanna-oauth-pool source", () => {
    expect(deriveAccountInfoFromOauth({ label: "work-account" })).toEqual({
      organization: "work-account",
      tokenSource: "kanna-oauth-pool",
    })
  })

  test("masked key only → AccountInfo with oauthKeyMasked + kanna-oauth-pool source", () => {
    expect(deriveAccountInfoFromOauth({ oauthKeyMasked: "sk-ant-oat01...1234" })).toEqual({
      oauthKeyMasked: "sk-ant-oat01...1234",
      tokenSource: "kanna-oauth-pool",
    })
  })

  test("label + masked → AccountInfo with both fields", () => {
    expect(deriveAccountInfoFromOauth({ label: "work-account", oauthKeyMasked: "sk-ant-oat01...1234" })).toEqual({
      organization: "work-account",
      oauthKeyMasked: "sk-ant-oat01...1234",
      tokenSource: "kanna-oauth-pool",
    })
  })
})

describe("PLAN_MODE_EXIT_UNSUPPORTED (state-unknown warning)", () => {
  test("PLAN_MODE_EXIT_UNSUPPORTED references plan mode and acceptEdits", () => {
    expect(PLAN_MODE_EXIT_UNSUPPORTED).toContain("plan mode")
    expect(PLAN_MODE_EXIT_UNSUPPORTED).toContain("acceptEdits")
  })
})

describe("SHIFT_TAB_KEY constant", () => {
  test("is the VT100 Shift+Tab sequence", () => {
    expect(SHIFT_TAB_KEY).toBe("\x1b[Z")
  })
})


async function makeTestHandle(opts?: { planMode?: boolean; additionalDirectories?: string[] }) {
  const homeDir = await mkdtemp(path.join(tmpdir(), "kanna-pm-"))
  const sentInputs: string[] = []
  const spawnEnvs: NodeJS.ProcessEnv[] = []
  let exitResolve!: (code: number) => void
  const exited = new Promise<number>((r) => { exitResolve = r })

  const fakePty: PtyProcess = {
    pid: 99999,
    async sendInput(data) { sentInputs.push(data) },
    resize() {},
    exited,
    close() { exitResolve(0) },
    kill() { exitResolve(137) },
  }

  const fakeSpawn = async (spawnArgs: SpawnPtyProcessArgs): Promise<PtyProcess> => {
    spawnEnvs.push(spawnArgs.env)
    spawnArgs.onOutput?.("❯ ")
    return fakePty
  }

  const fakeSmoke: import("./smoke-test").SmokeTestGate = {
    async canSpawn() { return { ok: true } },
  }

  const neverStream: TranscriptStream = {
    lines: {
      [Symbol.asyncIterator]() {
        return { next(): Promise<IteratorResult<string, undefined>> { return new Promise(() => {}) } }
      },
    },
    filePath: new Promise<string>(() => {}),
    close() {},
  }

  const handle = await startClaudeSessionPTY({
    chatId: "test", projectId: "test", localPath: homeDir,
    model: "claude-haiku-4-5-20251001",
    planMode: opts?.planMode ?? false,
    forkSession: false,
    oauthToken: "test-token",
    sessionToken: null,
    onToolRequest: async () => null,
    homeDir,
    ...(opts?.additionalDirectories ? { additionalDirectories: opts.additionalDirectories } : {}),
    env: {
      HOME: homeDir,
      CLAUDE_CODE_OAUTH_TOKEN: "test-token",
      KANNA_PTY_TRUST_DISMISS: "disabled",
      CLAUDE_EXECUTABLE: "/bin/sh",
    },
    spawnPtyProcess: fakeSpawn,
    startKannaMcpHttpServer: async () => ({ url: "http://127.0.0.1:0/mcp", bearerToken: "test", close: async () => {}, channelClientReady: Promise.resolve(), pushChannelPrompt: async () => {} }),
    startTranscriptStreamFn: async () => neverStream,
    smokeTestGate: fakeSmoke,
  })

  return {
    handle,
    sentInputs,
    spawnEnvs,
    async cleanup() {
      exitResolve(0)
      handle.close()
      await rm(homeDir, { recursive: true, force: true })
    },
  }
}

describe("multi-root memory switch on the PTY spawn", () => {
  test("set when the spawn has additional roots", async () => {
    if (process.platform === "win32") return
    const { spawnEnvs, cleanup } = await makeTestHandle({ additionalDirectories: ["/repo-b"] })
    try {
      expect(spawnEnvs[0]?.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD).toBe("1")
    } finally {
      await cleanup()
    }
  })

  test("absent on a solo spawn", async () => {
    if (process.platform === "win32") return
    const { spawnEnvs, cleanup } = await makeTestHandle()
    try {
      expect(spawnEnvs[0]?.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD).toBeUndefined()
    } finally {
      await cleanup()
    }
  })
})

describe("setPermissionMode (F1 — plan mode exit)", () => {
  test("setPermissionMode(true) sends /plan\\r and tracks state", async () => {
    if (process.platform === "win32") return
    const { handle, sentInputs, cleanup } = await makeTestHandle()
    try {
      await handle.setPermissionMode(true)
      expect(sentInputs).toContain("/plan\r")
    } finally {
      await cleanup()
    }
  }, 30_000)

  test("setPermissionMode(false) after true sends Shift+Tab \\x1b[Z", async () => {
    if (process.platform === "win32") return
    const { handle, sentInputs, cleanup } = await makeTestHandle()
    try {
      await handle.setPermissionMode(true)
      sentInputs.length = 0
      await handle.setPermissionMode(false)
      expect(sentInputs).toContain(SHIFT_TAB_KEY)
    } finally {
      await cleanup()
    }
  }, 30_000)

  test("setPermissionMode(false) when started with planMode:true sends Shift+Tab", async () => {
    if (process.platform === "win32") return
    const { handle, sentInputs, cleanup } = await makeTestHandle({ planMode: true })
    try {
      await handle.setPermissionMode(false)
      expect(sentInputs).toContain(SHIFT_TAB_KEY)
    } finally {
      await cleanup()
    }
  }, 30_000)

  test("setPermissionMode(false) without prior entry does NOT send Shift+Tab", async () => {
    if (process.platform === "win32") return
    const { handle, sentInputs, cleanup } = await makeTestHandle()
    try {
      await handle.setPermissionMode(false)
      expect(sentInputs).not.toContain(SHIFT_TAB_KEY)
    } finally {
      await cleanup()
    }
  }, 30_000)
})


async function spawnAndReadMcpConfig(opts: {
  sessionToken: string
  customMcpServers?: readonly McpServerConfig[]
}): Promise<{ parsed: { mcpServers: Record<string, unknown> }; cleanup: () => Promise<void> }> {
  const homeDir = await mkdtemp(path.join(tmpdir(), "kanna-t6-mcp-"))
  let exitResolve!: (code: number) => void
  const exited = new Promise<number>((r) => { exitResolve = r })

  const fakePty: PtyProcess = {
    pid: 88888,
    async sendInput() { },
    resize() {},
    exited,
    close() { exitResolve(0) },
    kill() { exitResolve(137) },
  }
  const fakeSpawn = async (spawnArgs: SpawnPtyProcessArgs): Promise<PtyProcess> => {
    spawnArgs.onOutput?.("❯ ")
    return fakePty
  }
  const fakeSmoke: import("./smoke-test").SmokeTestGate = {
    async canSpawn() { return { ok: true } },
  }
  const neverStream: TranscriptStream = {
    lines: {
      [Symbol.asyncIterator]() {
        return { next(): Promise<IteratorResult<string, undefined>> { return new Promise(() => {}) } }
      },
    },
    filePath: new Promise<string>(() => {}),
    close() {},
  }

  const handle = await startClaudeSessionPTY({
    chatId: "t6-test", projectId: "test", localPath: homeDir,
    model: "claude-haiku-4-5-20251001",
    planMode: false, forkSession: false,
    oauthToken: "test-token", sessionToken: opts.sessionToken,
    onToolRequest: async () => null,
    homeDir,
    env: {
      HOME: homeDir,
      CLAUDE_CODE_OAUTH_TOKEN: "test-token",
      KANNA_PTY_TRUST_DISMISS: "disabled",
      CLAUDE_EXECUTABLE: "/bin/sh",
    },
    customMcpServers: opts.customMcpServers,
    spawnPtyProcess: fakeSpawn,
    startKannaMcpHttpServer: async () => ({ url: "http://127.0.0.1:0/mcp", bearerToken: "test", close: async () => {}, channelClientReady: Promise.resolve(), pushChannelPrompt: async () => {} }),
    startTranscriptStreamFn: async () => neverStream,
    smokeTestGate: fakeSmoke,
  })

  const prefix = `kanna-pty-${opts.sessionToken.slice(0, 8)}-`
  const osTmp = tmpdir()
  const entries = await readdir(osTmp)
  const runtimeDirName = entries.find((e) => e.startsWith(prefix))
  if (!runtimeDirName) {
    throw new Error(`Could not find runtimeDir with prefix ${prefix} in ${osTmp}`)
  }
  const mcpConfigPath = path.join(osTmp, runtimeDirName, "mcp-config.json")
  const raw = await readFile(mcpConfigPath, "utf8")
  const parsed = JSON.parse(raw) as { mcpServers: Record<string, unknown> }

  return {
    parsed,
    async cleanup() {
      exitResolve(0)
      handle.close()
      await rm(homeDir, { recursive: true, force: true })
      await rm(path.join(osTmp, runtimeDirName), { recursive: true, force: true })
    },
  }
}

describe("PTY customMcpServers wiring (Task 6)", () => {
  test("mcp-config.json includes enabled user customMcpServers", async () => {
    if (process.platform === "win32") return
    const userServer: McpServerConfig = {
      id: "u1", name: "fs-tool", enabled: true,
      createdAt: "", updatedAt: "", lastTest: { status: "untested" },
      transport: "stdio", command: "/bin/ls", args: [], env: {},
    }
    const { parsed, cleanup } = await spawnAndReadMcpConfig({
      sessionToken: "t6-inc-001",
      customMcpServers: [userServer],
    })
    try {
      expect(parsed.mcpServers["fs-tool"]).toBeDefined()
      expect((parsed.mcpServers["fs-tool"] as { type: string }).type).toBe("stdio")
    } finally {
      await cleanup()
    }
  }, 30_000)

  test("mcp-config.json omits disabled customMcpServers", async () => {
    if (process.platform === "win32") return
    const enabled: McpServerConfig = {
      id: "u2", name: "enabled-srv", enabled: true,
      createdAt: "", updatedAt: "", lastTest: { status: "untested" },
      transport: "stdio", command: "/bin/echo", args: [], env: {},
    }
    const disabled: McpServerConfig = {
      id: "u3", name: "disabled-srv", enabled: false,
      createdAt: "", updatedAt: "", lastTest: { status: "untested" },
      transport: "stdio", command: "/bin/false", args: [], env: {},
    }
    const { parsed, cleanup } = await spawnAndReadMcpConfig({
      sessionToken: "t6-omit-001",
      customMcpServers: [enabled, disabled],
    })
    try {
      expect(parsed.mcpServers["enabled-srv"]).toBeDefined()
      expect(parsed.mcpServers["disabled-srv"]).toBeUndefined()
    } finally {
      await cleanup()
    }
  }, 30_000)
})

describe("session close escalation (graceful → SIGTERM → SIGKILL)", () => {
  test("close() escalates to SIGKILL when SIGTERM does not terminate within the grace window", async () => {
    if (process.platform === "win32") return
    let killSignal: NodeJS.Signals | number | undefined
    let exitResolve!: (code: number) => void
    const exited = new Promise<number>((r) => { exitResolve = r })
    const stubbornPty: PtyProcess = {
      pid: 99998,
      async sendInput() { },
      resize() {},
      exited,
      close() { },
      kill(signal) { killSignal = signal; exitResolve(137) },
    }
    const tmp = await mkdtemp(path.join(tmpdir(), "kanna-pty-close-"))
    try {
      const handle = await startClaudeSessionPTY({
        chatId: "test-close", projectId: "p", localPath: tmp,
        model: "claude-haiku-4-5-20251001",
        planMode: false, forkSession: false,
        oauthToken: "test-token", sessionToken: null,
        onToolRequest: async () => null,
        homeDir: tmp,
        env: { HOME: tmp, CLAUDE_CODE_OAUTH_TOKEN: "test-token", KANNA_PTY_TRUST_DISMISS: "disabled", CLAUDE_EXECUTABLE: "/bin/sh", KANNA_PTY_SESSION_END_GRACE_MS: "200" },
        spawnPtyProcess: async (s) => { s.onOutput?.("❯ "); return stubbornPty },
        startKannaMcpHttpServer: async () => ({ url: "http://127.0.0.1:0/mcp", bearerToken: "t", close: async () => {}, channelClientReady: Promise.resolve(), pushChannelPrompt: async () => {} }),
        startTranscriptStreamFn: async () => ({
          lines: { [Symbol.asyncIterator]() { return { next(): Promise<IteratorResult<string, undefined>> { return new Promise(() => {}) } } } },
          filePath: new Promise<string>(() => {}),
          close() {},
        }),
        smokeTestGate: { async canSpawn() { return { ok: true } } },
      })
      handle.close()
      const code = await Promise.race([
        exited,
        new Promise<number>((_, reject) => setTimeout(() => reject(new Error("escalation timed out")), 8_000)),
      ])
      expect(code).toBe(137)
      expect(killSignal).toBe("SIGKILL")
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }, 30_000)

  test("close() does not send SIGTERM when process exits within the grace window (SessionEnd hook completes)", async () => {
    if (process.platform === "win32") return
    let sigTermSent = false
    let sigKillSent = false
    let exitResolve!: (code: number) => void
    const exited = new Promise<number>((r) => { exitResolve = r })
    const cooperativePty: PtyProcess = {
      pid: 99997,
      async sendInput(text) {
        if (text === "/exit\r") setTimeout(() => exitResolve(0), 50)
      },
      resize() {},
      exited,
      close() { sigTermSent = true },
      kill() { sigKillSent = true },
    }
    const tmp = await mkdtemp(path.join(tmpdir(), "kanna-pty-close-grace-"))
    try {
      const handle = await startClaudeSessionPTY({
        chatId: "test-close-grace", projectId: "p", localPath: tmp,
        model: "claude-haiku-4-5-20251001",
        planMode: false, forkSession: false,
        oauthToken: "test-token", sessionToken: null,
        onToolRequest: async () => null,
        homeDir: tmp,
        env: { HOME: tmp, CLAUDE_CODE_OAUTH_TOKEN: "test-token", KANNA_PTY_TRUST_DISMISS: "disabled", CLAUDE_EXECUTABLE: "/bin/sh", KANNA_PTY_SESSION_END_GRACE_MS: "500" },
        spawnPtyProcess: async (s) => { s.onOutput?.("❯ "); return cooperativePty },
        startKannaMcpHttpServer: async () => ({ url: "http://127.0.0.1:0/mcp", bearerToken: "t", close: async () => {}, channelClientReady: Promise.resolve(), pushChannelPrompt: async () => {} }),
        startTranscriptStreamFn: async () => ({
          lines: { [Symbol.asyncIterator]() { return { next(): Promise<IteratorResult<string, undefined>> { return new Promise(() => {}) } } } },
          filePath: new Promise<string>(() => {}),
          close() {},
        }),
        smokeTestGate: { async canSpawn() { return { ok: true } } },
      })
      handle.close()
      await Promise.race([
        exited,
        new Promise<number>((_, reject) => setTimeout(() => reject(new Error("exit timed out")), 3_000)),
      ])
      expect(sigTermSent).toBe(false)
      expect(sigKillSent).toBe(false)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }, 30_000)
})

describe("keep-alive (Task 1)", () => {
  test("keepAlive: does NOT send /exit on first result, exposes pushChannelPrompt", async () => {
    if (process.platform === "win32") return
    const exitCalls: string[] = []
    const pushed: string[] = []

    const lineQueue: string[] = []
    const lineWaiters: Array<(r: IteratorResult<string>) => void> = []
    function notifyLine(line: string) {
      const w = lineWaiters.shift()
      if (w) w({ value: line, done: false })
      else lineQueue.push(line)
    }
    const emitLine: (line: string) => void = notifyLine
    const controlledStream: TranscriptStream = {
      lines: {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<string>> {
              if (lineQueue.length > 0) {
                const line = lineQueue.shift()!
                return Promise.resolve({ value: line, done: false })
              }
              return new Promise((resolve) => { lineWaiters.push(resolve) })
            },
          }
        },
      },
      filePath: Promise.resolve("/tmp/x.jsonl"),
      close: () => {
        const w = lineWaiters.shift()
        if (w) w({ value: undefined as unknown as string, done: true })
      },
    }

    const fakePty = {
      pid: 33333,
      sendInput: async (d: string) => { if (d.includes("/exit")) exitCalls.push(d) },
      resize() {},
      exited: new Promise<number>(() => {}),
      close: () => {},
      kill: () => {},
    } as unknown as PtyProcess

    const fakeHandle = {
      url: "http://127.0.0.1:1/mcp",
      bearerToken: "t",
      close: async () => {},
      channelClientReady: Promise.resolve(),
      pushChannelPrompt: async (c: string) => { pushed.push(c) },
    }

    const handle = await startClaudeSessionPTY({
      chatId: "ka-test", projectId: "p1", localPath: "/tmp",
      model: "claude-sonnet-4-6", planMode: false, forkSession: false,
      oauthToken: "sk-ant-oat01-x", sessionToken: null,
      systemPromptOverride: "You are a subagent.",
      initialPrompt: "turn one",
      oneShot: true,
      keepAlive: true,
      onToolRequest: async () => null,
      env: { ...process.env, KANNA_PTY_TRUST_DISMISS: "disabled", KANNA_PTY_CHANNEL_DELIVERY: "enabled", KANNA_PTY_TUI_BOOT_MS: "10" },
      startKannaMcpHttpServer: (async () => fakeHandle) as never,
      spawnPtyProcess: (async () => fakePty) as never,
      startTranscriptStreamFn: (async () => controlledStream) as never,
      smokeTestGate: { canSpawn: async () => ({ ok: true }) },
    })

    emitLine(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "turn one" }] }, isMeta: false }))
    emitLine(JSON.stringify({ type: "result", subtype: "success", result: "done", durationMs: 100, durationApiMs: 100, isError: false, totalCostUSD: 0 }))

    await new Promise((r) => setTimeout(r, 150))

    expect(exitCalls).toHaveLength(0)

    expect(pushed).toEqual(["turn one"])

    expect(typeof handle.pushChannelPrompt).toBe("function")

    await handle.pushChannelPrompt!("turn two")
    expect(pushed).toEqual(["turn one", "turn two"])

    handle.close()
  }, 30_000)

  test("keepAlive omitted on oneShot: handle.pushChannelPrompt is undefined", async () => {
    if (process.platform === "win32") return
    const fakePty = {
      pid: 44444,
      sendInput: async () => {},
      resize() {},
      exited: new Promise<number>(() => {}),
      close: () => {},
      kill: () => {},
    } as unknown as PtyProcess
    const fakeHandle = {
      url: "http://127.0.0.1:1/mcp", bearerToken: "t", close: async () => {},
      channelClientReady: Promise.resolve(),
      pushChannelPrompt: async () => {},
    }
    const handle = await startClaudeSessionPTY({
      chatId: "ka-neg", projectId: "p1", localPath: "/tmp",
      model: "claude-sonnet-4-6", planMode: false, forkSession: false,
      oauthToken: "sk-ant-oat01-x", sessionToken: null,
      systemPromptOverride: "You are a subagent.",
      initialPrompt: "hello",
      oneShot: true,
      onToolRequest: async () => null,
      env: { ...process.env, KANNA_PTY_TRUST_DISMISS: "disabled", KANNA_PTY_CHANNEL_DELIVERY: "enabled", KANNA_PTY_TUI_BOOT_MS: "10" },
      startKannaMcpHttpServer: (async () => fakeHandle) as never,
      spawnPtyProcess: (async () => fakePty) as never,
      startTranscriptStreamFn: (async () => ({ lines: (async function* () {})(), filePath: Promise.resolve("/tmp/x.jsonl"), close: () => {} })) as never,
      smokeTestGate: { canSpawn: async () => ({ ok: true }) },
    })
    expect(handle.pushChannelPrompt).toBeUndefined()
    handle.close()
  }, 30_000)
})

describe("channel-delivery (Task 5)", () => {
  test("oneShot channel delivery pushes initialPrompt via channel, not paste", async () => {
    if (process.platform === "win32") return
    const pushed: string[] = []
    const ptyWrites: string[] = []
    const fakeHandle = {
      url: "http://127.0.0.1:1/mcp", bearerToken: "t", close: async () => {},
      channelClientReady: Promise.resolve(),
      pushChannelPrompt: async (c: string) => { pushed.push(c) },
    }
    const fakePty = { pid: 11111, sendInput: async (d: string) => { ptyWrites.push(d) }, resize() {}, exited: new Promise<number>(() => {}), close: () => {}, kill: () => {} } as unknown as PtyProcess
    const handle = await startClaudeSessionPTY({
      chatId: "c1", projectId: "p1", localPath: "/tmp",
      model: "claude-sonnet-4-6", planMode: false, forkSession: false,
      oauthToken: "sk-ant-oat01-x", sessionToken: null,
      systemPromptOverride: "You are a subagent.",
      initialPrompt: "FULL MULTILINE PROMPT\nline2\nline3",
      oneShot: true,
      onToolRequest: async () => null,
      env: { ...process.env, KANNA_PTY_TRUST_DISMISS: "disabled", KANNA_PTY_CHANNEL_DELIVERY: "enabled", KANNA_PTY_TUI_BOOT_MS: "10" },
      startKannaMcpHttpServer: (async () => fakeHandle) as never,
      spawnPtyProcess: (async () => fakePty) as never,
      startTranscriptStreamFn: (async () => ({ lines: (async function* () {})(), filePath: Promise.resolve("/tmp/x.jsonl"), close: () => {} })) as never,
      smokeTestGate: { canSpawn: async () => ({ ok: true }) },
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(pushed).toEqual(["FULL MULTILINE PROMPT\nline2\nline3"])
    expect(ptyWrites.join("")).not.toContain("FULL MULTILINE PROMPT")
    try { if (handle.interrupt) await handle.interrupt() } catch { }
  }, 30_000)

  test("oneShot channel delivery fails fast when client never ready (no paste fallback)", async () => {
    if (process.platform === "win32") return
    const ptyWrites: string[] = []
    let closed = false
    const fakeHandle = {
      url: "http://127.0.0.1:1/mcp", bearerToken: "t", close: async () => {},
      channelClientReady: new Promise<void>(() => {}),
      pushChannelPrompt: async () => {},
    }
    const fakePty = { pid: 22222, sendInput: async (d: string) => { ptyWrites.push(d) }, resize() {}, exited: new Promise<number>(() => {}), close: () => { closed = true }, kill: () => {} } as unknown as PtyProcess
    const promise = startClaudeSessionPTY({
      chatId: "c1", projectId: "p1", localPath: "/tmp",
      model: "claude-sonnet-4-6", planMode: false, forkSession: false,
      oauthToken: "sk-ant-oat01-x", sessionToken: null,
      systemPromptOverride: "You are a subagent.",
      initialPrompt: "FULL MULTILINE PROMPT\nline2",
      oneShot: true,
      onToolRequest: async () => null,
      env: { ...process.env, KANNA_PTY_TRUST_DISMISS: "disabled", KANNA_PTY_CHANNEL_DELIVERY: "enabled", KANNA_PTY_TUI_BOOT_MS: "10", KANNA_PTY_CHANNEL_READY_TIMEOUT_MS: "30" },
      startKannaMcpHttpServer: (async () => fakeHandle) as never,
      spawnPtyProcess: (async () => fakePty) as never,
      startTranscriptStreamFn: (async () => ({ lines: (async function* () {})(), filePath: Promise.resolve("/tmp/x.jsonl"), close: () => {} })) as never,
      smokeTestGate: { canSpawn: async () => ({ ok: true }) },
    })
    await expect(promise).rejects.toThrow(/channel/i)
    expect(ptyWrites.join("")).not.toContain("FULL MULTILINE PROMPT")
    expect(closed).toBe(true)
  }, 30_000)
})

describe("follow-up sendPrompt TUI-ready gate (silent-hang fix)", () => {
  const fakeHandle = {
    url: "http://127.0.0.1:1/mcp", bearerToken: "t", close: async () => {},
    channelClientReady: Promise.resolve(),
    pushChannelPrompt: async () => {},
  }
  const idleStream = (async () => ({
    lines: { [Symbol.asyncIterator]() { return { next(): Promise<IteratorResult<string>> { return new Promise(() => {}) } } } },
    filePath: Promise.resolve("/tmp/x.jsonl"),
    close: () => {},
  })) as never

  test("waits for ❯ marker + ring-quiet before pasting a follow-up prompt", async () => {
    if (process.platform === "win32") return
    const sentInputs: string[] = []
    let pushOutput: (chunk: string) => void = () => {}
    const fakePty = {
      pid: 55555,
      sendInput: async (d: string) => { sentInputs.push(d) },
      resize() {}, exited: new Promise<number>(() => {}), close: () => {}, kill: () => {},
    } as unknown as PtyProcess
    const handle = await startClaudeSessionPTY({
      chatId: "followup-1", projectId: "p1", localPath: "/tmp",
      model: "claude-sonnet-4-6", planMode: false, forkSession: false,
      oauthToken: "sk-ant-oat01-x", sessionToken: null,
      systemPromptOverride: "You are a coding agent.",
      onToolRequest: async () => null,
      env: { ...process.env,
        KANNA_PTY_TRUST_DISMISS: "disabled",
        KANNA_PTY_CHANNEL_DELIVERY: "disabled",
        KANNA_PTY_TUI_BOOT_MS: "10",
        KANNA_PTY_TUI_READY_QUIET_MS: "20",
        KANNA_PTY_FOLLOWUP_READY_MS: "3000",
      },
      startKannaMcpHttpServer: (async () => fakeHandle) as never,
      spawnPtyProcess: (async (a: SpawnPtyProcessArgs) => { pushOutput = a.onOutput ?? (() => {}); return fakePty }) as never,
      startTranscriptStreamFn: idleStream,
      smokeTestGate: { canSpawn: async () => ({ ok: true }) },
    })

    const sendDone = handle.sendPrompt!("Ok")
    await new Promise((r) => setTimeout(r, 150))
    expect(sentInputs.some((d) => d.includes("\x1b[200~"))).toBe(false)

    pushOutput("❯ ")
    await sendDone
    expect(sentInputs.some((d) => d.includes("\x1b[200~Ok\x1b[201~"))).toBe(true)
    expect(sentInputs.some((d) => d === "\r")).toBe(true)
    handle.close()
  }, 30_000)

  test("never-ready REPL: warns and still sends after the cap (never worse than today)", async () => {
    if (process.platform === "win32") return
    const sentInputs: string[] = []
    const fakePty = {
      pid: 55556,
      sendInput: async (d: string) => { sentInputs.push(d) },
      resize() {}, exited: new Promise<number>(() => {}), close: () => {}, kill: () => {},
    } as unknown as PtyProcess
    const handle = await startClaudeSessionPTY({
      chatId: "followup-2", projectId: "p1", localPath: "/tmp",
      model: "claude-sonnet-4-6", planMode: false, forkSession: false,
      oauthToken: "sk-ant-oat01-x", sessionToken: null,
      systemPromptOverride: "You are a coding agent.",
      onToolRequest: async () => null,
      env: { ...process.env,
        KANNA_PTY_TRUST_DISMISS: "disabled",
        KANNA_PTY_CHANNEL_DELIVERY: "disabled",
        KANNA_PTY_TUI_BOOT_MS: "10",
        KANNA_PTY_TUI_READY_QUIET_MS: "20",
        KANNA_PTY_FOLLOWUP_READY_MS: "40",
      },
      startKannaMcpHttpServer: (async () => fakeHandle) as never,
      spawnPtyProcess: (async () => fakePty) as never,
      startTranscriptStreamFn: idleStream,
      smokeTestGate: { canSpawn: async () => ({ ok: true }) },
    })

    await handle.sendPrompt!("Ok")
    expect(sentInputs.some((d) => d.includes("\x1b[200~Ok\x1b[201~"))).toBe(true)
    handle.close()
  }, 30_000)
})

describe("buildChannelPromptFraming", () => {
  test("keep-alive subagent framing tells the model to expect multiple channel turns", () => {
    const framing = buildChannelPromptFraming(true)
    expect(framing).toMatch(/multiple/i)
    expect(framing).toMatch(/channel/i)
  })

  test("one-shot framing stays single-turn (no multiple-message language)", () => {
    const framing = buildChannelPromptFraming(false)
    expect(framing).toMatch(/channel/i)
    expect(framing).not.toMatch(/multiple/i)
  })
})
