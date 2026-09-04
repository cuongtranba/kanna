#!/usr/bin/env bun
// Scrapes src/**/*.ts for process.env.KANNA_* accesses, emits a TS data file.
// Hand-curated descriptions live in DESCRIPTIONS below.
//
// Test files are skipped on purpose: a knob only a suite reads (KANNA_PTY_E2E,
// KANNA_RUN_LIVE_TITLE_TESTS) is not something a user can usefully set, and
// listing it in a public reference invites configuring it.
//
// Only vars this scan FINDS are published, so a DESCRIPTIONS entry for a var
// the code does not read is silently dropped rather than documented into
// existence. That is deliberate — KANNA_HOME / KANNA_PORT / KANNA_PASSWORD sat
// here for months describing an env-var surface Kanna never had. Those are CLI
// flags (`--port`, `--password`); the data dir follows `HOME`.

import { Glob } from 'bun'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dir, '../../')
const SRC = path.join(REPO_ROOT, 'src')
const OUT = path.join(import.meta.dir, '../src/content/docs/reference/env-vars-data.ts')

const DESCRIPTIONS: Record<string, { default: string; description: string }> = {
  KANNA_CLAUDE_DRIVER: { default: 'sdk', description: 'Claude driver. Leave unset. "sdk" runs the Claude Agent SDK and is the supported mode; "pty" is a legacy path that drives the claude CLI under a pseudo-terminal, kept only for compatibility.' },
  KANNA_MCP_TOOL_CALLBACKS: { default: '0', description: 'Set to "1" to route AskUserQuestion / ExitPlanMode / built-in shims through the durable approval protocol.' },
  KANNA_SERVER_SECRET: { default: '(random per process)', description: 'Stabilises HMAC tool-request ids across process restarts.' },
  KANNA_CRON_REPAIR: { default: 'enabled', description: 'Set to "disabled" to stop handing an invalid /cron line to the agent for repair. It only ever fires where Kanna has no corrected command of its own; the validate_cron / arm_cron tools stay registered either way.' },
  KANNA_CRON_CONFIRM: { default: 'enabled', description: 'Set to "disabled" to stop the host from escalating a typed /cron arm to a model review turn. When enabled, the model presents the full job config and asks the user to confirm, change, or disarm. Only fires on the typed path — arm_cron already confirms in-turn.' },
  KANNA_SYSTEM_PROMPT_APPEND: { default: '(unset)', description: 'Appended to the system prompt for every agent spawn.' },
  KANNA_SUBAGENT_MAX_LIVE: { default: '5', description: 'Max concurrent keep-alive (warm) subagent processes per chat. Over cap, delegate_subagent({keep_alive:true}) fails CAP_EXCEEDED.' },
  KANNA_SUBAGENT_IDLE_TIMEOUT_MS: { default: '300000', description: 'Idle window after which a keep-alive subagent session is auto-closed. Reset on each turn.' },
  KANNA_SUBAGENT_RUN_TIMEOUT_MS: { default: '(orchestrator default)', description: 'Stall watchdog for a single subagent run. The Settings value wins over this; this wins over the built-in default. Read once at server start.' },
  KANNA_MERMAID_GUARD: { default: 'enabled', description: 'Set to "disabled" to stop the end-of-turn check that asks the model to fix a mermaid diagram that would not render. The validate_mermaid tool stays registered either way.' },
  KANNA_OTEL: { default: '(unset)', description: 'Overrides the Settings telemetry toggle: "disabled" hard-disables export, "enabled" turns it on even when the setting is off. Unset means the setting decides.' },
  KANNA_OTEL_SERVICE_NAME: { default: 'kanna-<machine name>', description: 'OTel service.name for this install. Overrides the name derived from the computer name.' },
  KANNA_OTEL_METRIC_INTERVAL_MS: { default: '15000', description: 'How often metrics are exported to the OTLP endpoint.' },
  KANNA_MEMLOG_MS: { default: '60000', description: 'Interval between "[kanna/mem] rss=…" process-memory log lines. Set to 0 to disable.' },
  KANNA_HEAP_SNAPSHOT: { default: 'enabled', description: 'Set to "disabled" to stop SIGUSR2 from writing a V8 heap snapshot under the data dir. `kill -USR2 <pid>` is how you find what is holding memory on a live process.' },
  KANNA_RUNTIME_PROFILE: { default: 'prod', description: 'Set to "dev" to use a separate data root (~/.kanna-dev instead of ~/.kanna), so a development run cannot touch real chats. `bun run dev` sets this for you.' },
  KANNA_LOG_ANALYTICS: { default: '0', description: 'Set to "1" to log analytics payloads to stderr. Debugging aid.' },
  KANNA_LOG_CLAUDE_STEER: { default: '0', description: 'Set to "1" to log mid-turn steering messages sent to Claude. Debugging aid.' },
  KANNA_PROFILE_SEND_TO_STARTING: { default: '0', description: 'Set to "1" to log timing for each stage between a send and the turn actually starting. Use when a chat feels slow to begin.' },
  KANNA_PTY_BACKGROUND_TASK_MAX_MS: { default: '1800000', description: 'How long a launched background task may hold a session warm against the idle reaper (30 min). Only applies to a session with no live task list from the SDK; when the SDK reports its background tasks, set membership decides and this deadline is never consulted. The KANNA_PTY_ prefix is historical.' },
  KANNA_BACKGROUND_TASK_MAX_WAKES: { default: '3', description: 'How many times a background task may wake its chat after the keep-alive deadline passes before Kanna stops re-waking it.' },
  KANNA_IMPORT_FOLLOW_POLL_MS: { default: '2000', description: 'Stat-poll tick interval driving the single-session-import live-tail FollowedSessionRegistry.' },
  KANNA_IMPORT_FOLLOW_ACTIVE_WINDOW_MS: { default: '600000', description: 'A single-session import only auto-arms live-tailing when the source file mtime is within this window of "now".' },
  KANNA_IMPORT_FOLLOW_IDLE_MS: { default: '600000', description: 'The live-tail registry stops following a session after this long with no source file growth.' },
  KANNA_OPENROUTER_FIRST_ENTRY_TIMEOUT_MS: { default: '120000', description: 'Fail-close timeout for an OpenRouter turn whose SDK stream stalls before the first transcript entry.' },
  KANNA_CLAUDE_SESSION_IDLE_MS: { default: '600000', description: 'Idle window before a resident Claude session is reaped (10 min).' },
  KANNA_CLAUDE_SESSION_MAX_RESIDENT: { default: '4', description: 'Max simultaneously resident Claude sessions before the least-recently-used is reaped.' },
  KANNA_CLAUDE_SESSION_SWEEP_INTERVAL_MS: { default: '60000', description: 'How often the resident-session reaper sweeps for idle sessions.' },
  KANNA_RELOADER: { default: 'supervisor', description: 'Self-update reload strategy: "supervisor" (default, end-user) or "pm2" (self-host, requires KANNA_REPO_DIR).' },
  KANNA_REPO_DIR: { default: '(unset)', description: 'Repo checkout the pm2 reloader pulls/rebuilds. Required when KANNA_RELOADER=pm2.' },
  KANNA_DISABLE_SELF_UPDATE: { default: '0', description: 'Set to "1" to disable the in-app self-update path.' },
}

const seen = new Set<string>()
const glob = new Glob('**/*.ts')

for await (const file of glob.scan({ cwd: SRC })) {
  if (file.endsWith('.test.ts') || file.includes('__fixtures__') || file.includes('test-helpers')) continue
  const content = await Bun.file(path.join(SRC, file)).text()
  const matches = content.matchAll(/process\.env\.(KANNA_[A-Z0-9_]+)/g)
  for (const m of matches) seen.add(m[1])
}

const sorted = Array.from(seen).sort()
const lines = sorted.map(name => {
  const meta = DESCRIPTIONS[name] ?? { default: '(undocumented)', description: '(no description — add one to extract-env-vars.ts DESCRIPTIONS)' }
  return `  { name: '${name}', default: ${JSON.stringify(meta.default)}, description: ${JSON.stringify(meta.description)} },`
}).join('\n')

const out = `// Auto-generated by wiki/scripts/extract-env-vars.ts. Do not edit by hand.
export interface EnvVar { name: string; default: string; description: string }
export const envVars: EnvVar[] = [
${lines}
]
`

await Bun.write(OUT, out)
console.log(`Wrote ${sorted.length} env vars to ${OUT}`)
