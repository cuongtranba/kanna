import { describe, expect, test } from "vite-plus/test"
import { DEFAULT_AGENT_RUNTIME_CONFIG, resolveAgentRuntimeConfig } from "./agent-runtime-config"

describe("resolveAgentRuntimeConfig", () => {
  test("an empty environment yields the built-in defaults", () => {
    expect(resolveAgentRuntimeConfig({})).toEqual(DEFAULT_AGENT_RUNTIME_CONFIG)
    expect(DEFAULT_AGENT_RUNTIME_CONFIG.claudeSessionLifecycle).toEqual({
      idleMs: 600_000,
      maxResidentSessions: 4,
      sweepIntervalMs: 60_000,
      backgroundTaskMaxMs: 1_800_000,
      backgroundTaskMaxWakes: 3,
    })
    expect(DEFAULT_AGENT_RUNTIME_CONFIG.endpointFirstEntryTimeoutMs).toBe(120_000)
    expect(DEFAULT_AGENT_RUNTIME_CONFIG.cronRepairEnabled).toBe(true)
    expect(DEFAULT_AGENT_RUNTIME_CONFIG.subagentMaxLive).toBeUndefined()
  })

  test("only the literal value disabled switches a guard off", () => {
    const config = resolveAgentRuntimeConfig({
      KANNA_CRON_REPAIR: "disabled",
      KANNA_CRON_CONFIRM: "off",
      KANNA_MERMAID_GUARD: "disabled",
    })
    expect(config.cronRepairEnabled).toBe(false)
    expect(config.cronConfirmEnabled).toBe(true)
    expect(config.mermaidGuardEnabled).toBe(false)
  })

  test("integer variables override defaults and invalid values fall back", () => {
    const config = resolveAgentRuntimeConfig({
      KANNA_CLAUDE_SESSION_IDLE_MS: "1234",
      KANNA_CLAUDE_SESSION_MAX_RESIDENT: "nope",
      KANNA_SUBAGENT_MAX_LIVE: "7",
      KANNA_SUBAGENT_IDLE_TIMEOUT_MS: "0",
      KANNA_SUBAGENT_RUN_TIMEOUT_MS: "9000",
      KANNA_OPENROUTER_FIRST_ENTRY_TIMEOUT_MS: "250",
    })
    expect(config.claudeSessionLifecycle.idleMs).toBe(1234)
    expect(config.claudeSessionLifecycle.maxResidentSessions).toBe(4)
    expect(config.subagentMaxLive).toBe(7)
    expect(config.subagentIdleTimeoutMs).toBeUndefined()
    expect(config.subagentRunTimeoutMs).toBe(9000)
    expect(config.endpointFirstEntryTimeoutMs).toBe(250)
  })

  test("the former PTY background-task name is read only when the new one is unset", () => {
    expect(
      resolveAgentRuntimeConfig({ KANNA_PTY_BACKGROUND_TASK_MAX_MS: "5000" }).claudeSessionLifecycle.backgroundTaskMaxMs,
    ).toBe(5000)
    expect(
      resolveAgentRuntimeConfig({
        KANNA_CLAUDE_BACKGROUND_TASK_MAX_MS: "7000",
        KANNA_PTY_BACKGROUND_TASK_MAX_MS: "5000",
      }).claudeSessionLifecycle.backgroundTaskMaxMs,
    ).toBe(7000)
  })
})
