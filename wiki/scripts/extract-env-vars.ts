#!/usr/bin/env bun
// Scrapes src/**/*.ts for process.env.KANNA_* accesses, emits a TS data file.
// Hand-curated descriptions live in DESCRIPTIONS below.

import { Glob } from 'bun'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dir, '../../')
const SRC = path.join(REPO_ROOT, 'src')
const OUT = path.join(import.meta.dir, '../src/content/docs/reference/env-vars-data.ts')

const DESCRIPTIONS: Record<string, { default: string; description: string }> = {
  KANNA_HOME: { default: '~/.kanna/', description: 'Data directory (chats, projects, OAuth pool, settings).' },
  KANNA_PORT: { default: '3210', description: 'HTTP server port.' },
  KANNA_PASSWORD: { default: '(unset)', description: 'HTTP/WS/API password gate. Recommended for exposed deployments.' },
  KANNA_CLAUDE_DRIVER: { default: 'sdk', description: 'Driver mode: "sdk" (API rates) or "pty" (subscription billing, macOS/Linux only).' },
  KANNA_MCP_TOOL_CALLBACKS: { default: '0', description: 'Set to "1" to route AskUserQuestion / ExitPlanMode / built-in shims through the durable approval protocol.' },
  KANNA_SERVER_SECRET: { default: '(random per process)', description: 'Stabilises HMAC tool-request ids across process restarts.' },
  KANNA_CRON_REPAIR: { default: 'enabled', description: 'Set to "disabled" to stop handing an invalid /cron line to the agent for repair. It only ever fires where Kanna has no corrected command of its own; the validate_cron / arm_cron tools stay registered either way.' },
  KANNA_CRON_CONFIRM: { default: 'enabled', description: 'Set to "disabled" to stop the host from escalating a typed /cron arm to a model review turn. When enabled, the model presents the full job config and asks the user to confirm, change, or disarm. Only fires on the typed path — arm_cron already confirms in-turn.' },
  KANNA_SYSTEM_PROMPT_APPEND: { default: '(unset)', description: 'Appended to the system prompt for every agent spawn (both SDK and PTY drivers).' },
  KANNA_SUBAGENT_MAX_LIVE: { default: '5', description: 'Max concurrent keep-alive (warm) subagent processes per chat. Over cap, delegate_subagent({keep_alive:true}) fails CAP_EXCEEDED.' },
  KANNA_SUBAGENT_IDLE_TIMEOUT_MS: { default: '300000', description: 'Idle window after which a keep-alive subagent session is auto-closed. Reset on each turn.' },
  KANNA_PTY_BACKGROUND_TASK_MAX_MS: { default: '1800000', description: 'Max time a launched background Bash task keeps the PTY session warm before the idle reaper may reclaim it (30 min).' },
  KANNA_IMPORT_FOLLOW_POLL_MS: { default: '2000', description: 'Stat-poll tick interval driving the single-session-import live-tail FollowedSessionRegistry.' },
  KANNA_IMPORT_FOLLOW_ACTIVE_WINDOW_MS: { default: '600000', description: 'A single-session import only auto-arms live-tailing when the source file mtime is within this window of "now".' },
  KANNA_IMPORT_FOLLOW_IDLE_MS: { default: '600000', description: 'The live-tail registry stops following a session after this long with no source file growth.' },
  KANNA_IMPORT_MAX_ROLLOUT_BYTES: { default: '33554432', description: 'Ceiling on one session source file (32 MiB). A larger file is refused with too_large rather than parsed — the largest observed Codex rollout is 91 MB and parsing one costs about half a gigabyte of RSS. Raise this to import a rollout the default refuses; it applies to full import, single-session import, and the live-tail delta alike.' },
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
