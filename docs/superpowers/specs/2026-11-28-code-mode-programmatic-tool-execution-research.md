# Code Mode and programmatic tool execution for Kanna: research and recommendation

Date: 2026-11-28. Status: research only, no implementation authorized. Base revision: `origin/main` at
`49141fb3` (Agent SDK `0.3.330`, bundled Claude Code CLI `2.1.330`). The local `main` checkout was 99
commits behind at `6b8fd9d2`; every Kanna citation below was re-read on `49141fb3`.

Evidence labels used throughout:

- **[DOC]**: stated in a primary Anthropic or Cloudflare document, fetched 2026-11-28.
- **[CHANGELOG]**: stated in `anthropics/claude-code` `CHANGELOG.md` (top entry 2.1.332).
- **[RE]**: reverse-engineered from the strings of the Claude Code 2.1.332 native binary shipped in
  `@anthropic-ai/claude-agent-sdk-linux-x64@0.3.332`. Undocumented, may change in any release.
- **[PROBE]**: observed in a local run of that binary through the Agent SDK in a scratch directory.
- **[CODE]**: read in Kanna source at `49141fb3`.
- **[ASSUMPTION]**: not verified; stated so it can be tested.

## 1. Executive summary

1. **Native Code Mode is technically reachable from Kanna's transport, but only through an
   undocumented path.** The public Code Mode page says the surface must be "an interactive `claude`
   session in a terminal" [DOC]. The changelog for 2.1.332 fixes bugs in "Code Mode sessions in the
   Agent SDK and `claude -p`" [CHANGELOG], and the 2.1.332 binary's own refusal text says
   "claude -p and Agent SDK apps get it only when CLAUDE_CODE_EXPERIMENTAL_CODE_MODE is in the env block of
   --settings (the SDK's settings option)" [RE]. A local probe confirmed that this path clears the
   entrypoint and model gates [PROBE]. The documentation and the binary disagree, so the SDK path is
   not a supported contract today.
2. **Kanna would not lose a safety property it has today, but it would not gain one either.** Kanna's
   Claude `canUseTool` allows every tool except `AskUserQuestion` and `ExitPlanMode`
   (`src/server/claude-spawn-helpers.ts:72-101`) [CODE]. Claude chats therefore have no per-tool human
   approval now; the real controls are `PreToolUse` hooks (loop guard, inbox guard), path confinement and
   the user's own settings. Code Mode routes inner calls through rules and `PreToolUse` hooks under each
   tool's usual name [DOC], but whether the SDK's in-process callback hooks see every inner call is
   unverified, and the inbox guard is a security boundary.
3. **No token, latency or correctness numbers for Code Mode in Kanna could be measured.** The final
   Code Mode gate (organization policy read) needs a valid login. The standalone `~/.claude` OAuth
   session has expired and could not be refreshed, Kanna's pooled tokens must not be extracted, and the
   Agent Vault brokers no Anthropic credential. A reproducible harness and a synthetic dataset with
   ground truth are in Appendix B. Anthropic's 98.7 % figure (Google Drive to Salesforce, 150,000 to
   2,000 tokens) is one illustrative example and is not a Kanna expectation; Anthropic's own measured
   PTC figures range from 38 % fewer input tokens on a 75-tool benchmark to 8 % *more* cost on
   sequential single-call work [DOC].
4. **Recommendation.**
   - **Status quo now: GO.** Keep shipping without Code Mode.
   - **Option A (native opt-in passthrough), as a gated spike behind a server env var on a dev
     instance: CONDITIONAL GO.** Ship to users only after Anthropic documents the SDK surface or the
     acceptance gates in section 9 pass on the pinned CLI.
   - **Option B (Kanna-built sandboxed program runner): NO-GO for now.** It is a new orchestration and
     isolation subsystem whose payoff is unmeasured, and Kanna's own Claude path would get it natively.
     Revisit only if Codex or Antigravity sessions show a measured orchestration cost that matters.
   - **Option C (hybrid): NO-GO** until B is justified on its own; C carries B's cost plus A's.

## 2. Verified external facts

### 2.1 Claude Code Code Mode

| Question | Finding | Label |
| --- | --- | --- |
| What it is | Claude writes JavaScript that calls tools; Claude Code runs it in the session. Experimental, off by default, "may change or be removed in any release". | DOC |
| Enabling | `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` in the shell or `~/.claude/settings.json`. A project's settings files cannot turn it on. A `0` anywhere wins; managed settings can force `0`. | DOC |
| Headless enabling | In `claude -p` and Agent SDK apps the variable is honoured only from the flag-settings layer (`--settings`, the SDK `settings` option); the shell environment is ignored there. | RE, PROBE |
| First release | Added in 2.1.323. Cloud providers need 2.1.331. Agent teams 2.1.326, mods 2.1.327, OpenTelemetry events 2.1.329. | DOC, CHANGELOG |
| Tool | `REPL`, "Available only when Code Mode is on". A `PreToolUse` hook reads the script from `tool_input.code`. `PostToolUse` `tool_response` carries `code`, `result`, `stdout`, `stderr`, `toolsUsed`, optional `error`, `images`, `documents`, `uncutOutputNote`. No other public schema; the SDK typings (`sdk.d.ts`, `sdk-tools.d.ts` in 0.3.332) have no `REPL` input type. | DOC |
| Script API | `$` shell tagged template (`.text()`, `.nothrow()`), `edit()`, `write()`, `log`, `preview`, `sleep`, a `tools` accessor, tool search for MCP tools. Partly documented by example only. | DOC, CHANGELOG |
| Models | Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.2 (gate: major 5, minor >= 5, or Fable/Mythos >= 5.2). | DOC, RE |
| Accounts | Claude subscription, Console account, cloud providers (2.1.331+). Not through a gateway, an API key helper, `ANTHROPIC_AUTH_TOKEN`, custom auth headers, HIPAA or ZDR. In headless mode, first-party Anthropic API only. | DOC, RE |
| Surfaces | Docs: interactive terminal only; not VS Code, Desktop, cloud sessions. Binary: "the terminal, with claude -p, and in Agent SDK apps, and not in cloud, remote, or prewarmed sessions". | DOC vs RE |
| Other refusals | `--restricted`, a `--tools` list without `REPL`, `REPL` in `disallowedTools` or a deny rule; `CLAUDE_AGENT_SDK_MCP_NO_PREFIX` set; background jobs, teammates' split panes, Remote Control; OpenTelemetry tracing on. | DOC, RE, PROBE |
| Resume | A Code Mode session resumes only with Code Mode on; a session started without it resumes without it. On resume, earlier script variables are gone. | DOC, CHANGELOG |
| Fork | `/fork` cannot start a background copy. Behaviour of SDK `forkSession` is not documented. | DOC; SDK fork is ASSUMPTION |
| Permissions | Rules and `PreToolUse` hooks apply to inner calls under the tool's usual name. In auto mode the classifier reviews the code, not each call, and cannot see run-time values. In the asking modes the user is prompted per inner call. A Bash hook can receive `cd 'app' && git push`. | DOC |
| Hook failure | A `PreToolUse` hook that errors no longer refuses the inner call unless `onFailure: "block"` (2.1.329). | DOC, CHANGELOG |
| Output redaction | Use `PostToolUse` on `REPL` with `updatedToolOutput`; `refusedCalls` can repeat refused input unredacted. | DOC |
| Sandbox | The shell sandbox applies to commands the script runs. The JavaScript itself and its file, web and MCP calls run outside the sandbox. | DOC |
| Time limits | Foreground script stops after 10 minutes; background scripts up to 2 hours in auto or bypass modes. Time at a permission prompt does not count in manual and acceptEdits modes (2.1.328+). | DOC |
| Cancellation | Esc stops the script; finished calls stay applied. Background shell commands, subagents and MCP calls the script started can keep running and must be stopped from `/tasks`. | DOC |
| Subagents | A subagent with a `tools` list needs `REPL` in it to use Code Mode. | DOC |
| Telemetry | Inner calls emit OpenTelemetry `tool_decision` and `tool_result` under the usual tool name, with `tool_use_id` prefixed `repl_` or `toolu_cc_`. | DOC |
| Maturity | 2.1.323 to 2.1.332 contain 79 changelog entries about Code Mode (49 of them fixes), including lost replies on SDK resume, silently skipped tool calls, runaway memory and stalled subagents. | CHANGELOG |

### 2.2 Anthropic "Code execution with MCP" (engineering article)

The article proposes presenting MCP servers as a file tree of typed functions that the agent reads on
demand, with control flow, filtering and privacy-preserving data flow (PII tokenized in the harness)
running in code [DOC]. The 98.7 % saving (150,000 to 2,000 tokens) follows a single Google Drive to
Salesforce example and is not itemized [DOC]. The article warns that running agent code "requires a
secure execution environment" with sandboxing, resource limits and monitoring [DOC].

### 2.3 Anthropic Programmatic Tool Calling (Messages API)

PTC is a Messages API feature: a `code_execution_20260120` (or later) server tool plus
`allowed_callers: ["code_execution_20260120"]` on client tools [DOC]. Claude's Python in an
Anthropic-managed container calls those tools; each call reaches the client as a `tool_use` with a
`caller` field, and its result does not enter the model's context [DOC]. Constraints: MCP connector
tools cannot be called programmatically, `allowed_callers` "is not a hard API-level block" and must
not be used as a security boundary, a pending call times out after about 4 minutes, results must be
text, not ZDR-eligible [DOC]. Measured by Anthropic: about 38 % fewer billed input tokens on a 75-tool
benchmark with no accuracy change; unchanged score and about 8 % more cost on tau-squared-bench; 20 to
40 % typical savings for requests with 10 to 49 tools [DOC].

**Relevance to Kanna:** low. Kanna does not own a Messages API loop for Claude chats; it drives the
CLI through the Agent SDK. PTC would matter only for a Kanna-owned loop, which does not exist.

### 2.4 Cloudflare Code Mode

MCP tools become a generated TypeScript API; code runs in a fresh V8 isolate per snippet created by the
Worker Loader API; `fetch()` and `connect()` throw; MCP access is through RPC bindings that the
supervisor authorizes, so "the AI cannot possibly write code that leaks any keys" [DOC]. No
quantitative results are reported [DOC]. This is the reference design for an isolation-first Option B.

## 3. Compatibility probe (what was actually run)

Setup: SDK `0.3.332` installed into `/tmp/cm-sdk-pkg` with `--ignore-scripts`; scripts in a separate
`/tmp/cm-probe-scripts`; working directory `/tmp/cm-probe-work` holding 40 synthetic Markdown files with 13
known broken links. `settingSources: []` so the user's hooks and settings were not loaded; all
`CLAUDE*`, `CLAUDECODE` and `ANTHROPIC*` variables stripped from the child env. No global file was
changed; the headless opt-in path writes no consent key to `~/.claude.json` [RE: the
`codeModeCaveatsAcceptedV1` write sits only in the interactive confirmation path]. The probe's session
transcripts were deleted afterwards.

| Variant | `REPL` in init tools | Code Mode notice |
| --- | --- | --- |
| `settings.env` = 1, `claude-haiku-5-5` | no | "isn't available: Claude Code couldn't read your organization's settings or policy" |
| `settings.env` = 1, `claude-opus-5-5` | no | same (passed the entrypoint and model gates, stopped at policy read) |
| `settings.env` = 1, `claude-sonnet-4-6` | no | "for now it only works with Opus 5.5, Sonnet 5.5 and later models" |
| `settings.env` = 1 plus `CLAUDE_AGENT_SDK_MCP_NO_PREFIX=1` | no | "CLAUDE_AGENT_SDK_MCP_NO_PREFIX is set, so the app's own tools could take the names of the functions that scripts use" |
| process env only (`env` option) = 1 | no | none: silently off |
| `settings.env` = 1, `tools: [Read, Glob, Grep]` | no | policy-read notice (the expected `tools` refusal was masked; inconclusive) |
| `settings.env` = 0 | no | none |

Every run then failed with `Failed to authenticate: OAuth session expired and could not be refreshed`
before any model request, so no tokens were spent.

**Conclusion:** the SDK entrypoint with the `settings` option is the opt-in mechanism in the binary
Kanna would ship; the last gate needs a valid first-party login. Whether `REPL` then appears, how inner
calls appear on the SDK stream, and whether SDK callback hooks and `canUseTool` fire for them are
**unverified** (blocker B1 in section 8).

## 4. Kanna today (findings, `49141fb3`)

| Area | Finding | Evidence |
| --- | --- | --- |
| Transport | Claude, OpenRouter and custom endpoints all run SDK `query()` in streaming-input mode with a long-lived `AsyncMessageQueue`; no PTY, no direct `claude -p`. | `src/server/claude-session-start.ts:182-244`; `src/server/provider-catalog.ts:114-116` |
| Binary | SDK-bundled CLI unless `CLAUDE_EXECUTABLE` overrides it. | `claude-session-start.ts:233` |
| Settings layers | `settingSources: ["user", "project", "local"]`; no `settings` option, so Code Mode cannot turn on today even if a user sets the variable in `~/.claude/settings.json` (headless ignores that source). | `claude-session-start.ts:232` [CODE + RE] |
| Tools | Default chats get the `claude_code` preset plus Grep, Glob and Task tools, minus CLI tools Kanna owns. Path-confined chats get an explicit 16-tool list without `REPL`, which would make Code Mode refuse ("tools"). | `src/server/claude-session-config.ts:110-163` |
| Permission mode | `acceptEdits`, or `plan`; toggled in place with `setPermissionMode`. | `claude-session-start.ts:204,315-316` |
| `canUseTool` | Allows everything except `AskUserQuestion` and `ExitPlanMode`, which are parked for the user. | `claude-spawn-helpers.ts:72-101` |
| Hooks | `PreToolUse` callback matchers: the loop guard (denies listed native tools while a loop is armed) and the inbox guard; `PreCompact`/`PostCompact` observers. | `claude-session-start.ts:54-116` |
| Durable approvals | `ToolCallbackService` (HMAC request ids, args hash, toolUseId dedup) is now used only by beacon tools; the `KANNA_MCP_TOOL_CALLBACKS` flag path was removed in #1516. | `src/server/tool-callback.ts:41-80`; `kanna-mcp-beacon.ts:176` |
| Env | `buildClaudeEnv` strips `CLAUDECODE` and `CLAUDE_CODE_OAUTH_TOKEN`, then injects a pool OAuth token or API key, or, for custom endpoints, `ANTHROPIC_BASE_URL` plus `ANTHROPIC_AUTH_TOKEN` (which Code Mode refuses). | `claude-spawn-helpers.ts:133-170` |
| MCP | In-process `mcp__kanna__*` via `createSdkMcpServer`; user MCP servers passed to the SDK with OAuth bearers as headers. | `claude-session-start.ts:212-224`; `claude-session-config.ts` (`buildUserMcpServers`) |
| Rendering | `REPL` would normalize to `unknown_tool` with `payload` = input; MCP tools to `mcp_generic`. No tree built from `parent_tool_use_id` in the normalizer. | `src/shared/tools.ts:258-265`; `claude-message-normalizer.ts` |
| Respawn | A new CLI process (with `--resume`) when endpoint fingerprint, path, effort, fork, extra directories, loop-armed state, pending clear or stale bearers change; model changes are applied in place with `setModel`. | `src/server/claude-session-spawner.ts:129-144,289-293` |
| Resume failure | Only "No conversation found with session ID" triggers the fresh-session retry; any other resume refusal surfaces as a failed turn. | `claude-prompt-helpers.ts:49`; `claude-session-runner.ts:85-107` |
| Cancel | In-band `q.interrupt()` raced against a 5 s grace, then `close()`. | `src/server/claude-cancel-handler.ts`; `src/server/harness-types.ts:25` |
| Providers | `AGENT_PROVIDERS` = `claude`, `codex` (app-server), `antigravity` (ACP, #1504), `openrouter`, `custom`; `isClaudeSdkProvider` sends `claude` and the endpoint providers to the SDK path. No capability table; behaviour branches on predicates. | `src/shared/core-types.ts:13`; `src/server/provider-catalog.ts:114-116` |
| Usage data | Transcript entries keep the raw SDK `result` in `debugRaw` (usage, modelUsage, num_turns, durations); transcripts at `~/.kanna/data/transcripts/<chatId>.jsonl`, turn results also in `~/.kanna/data/turns.jsonl`. | `claude-message-normalizer.ts`; `event-logs.ts` |

### 4.1 Current flow

```mermaid
sequenceDiagram
    autonumber
    participant U as "Kanna client"
    participant S as "Kanna server (agent-coordinator)"
    participant Q as "SDK query() + AsyncMessageQueue"
    participant C as "Claude Code CLI child (stream-json)"
    participant M as "Anthropic API"
    participant T as "Tools: built-ins, mcp__kanna__*, custom MCP"
    U->>S: chat.send
    S->>Q: sendPrompt (resume = session token)
    Q->>C: user message
    loop once per tool call
        C->>M: request (full context)
        M-->>C: assistant tool_use
        C->>S: canUseTool (allow unless AskUserQuestion or ExitPlanMode)
        C->>S: PreToolUse hooks (loop guard, inbox guard)
        C->>T: execute
        T-->>C: tool_result (whole output joins the context)
        C-->>Q: assistant and user messages
        Q-->>S: normalize to tool_call and tool_result entries
        S-->>U: transcript diff
    end
    C->>M: final request
    M-->>C: text
    C-->>S: result (usage, cost)
```

### 4.2 An unplanned baseline data point

The read-only research subagent behind this report ran in a normal Kanna session (Haiku 5.5, no Code
Mode) and audited the repository: 75 model turns, 7,463,544 cache-read tokens, 193,690 cache-creation
tokens, 66,410 output tokens, 321 s, USD 0.61 list price (from its `result` record in
`~/.kanna/data/turns.jsonl`). This is the multi-file audit shape Code Mode targets, and it shows that in
Kanna's real traffic the cost is dominated by **cache reads of a growing prefix per round trip**, not by
fresh input. A Code Mode benchmark should therefore count round trips and cache-read tokens, not only
`input_tokens`. It is one uncontrolled run, not a comparison.

## 5. Options

### 5.0 Baseline: status quo

Every tool call is one model round trip; intermediate output enters the context; the transcript shows
one row per call. Correct, auditable, provider-portable, and already paid for.

### 5.1 Option A: native Code Mode opt-in passthrough (Claude SDK path only)

Shape: one new per-chat (or per-server, for the spike) decision, "Code Mode", owned by the Claude
session start. When on, `startClaudeSession` passes
`settings: { env: { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "1" } }` and the chat's choice joins the respawn
fingerprint so it is fixed for the session's lifetime. Everything else is existing machinery.

```mermaid
sequenceDiagram
    autonumber
    participant S as "Kanna server"
    participant C as "Claude Code CLI (Code Mode on via settings.env)"
    participant M as "Anthropic API"
    participant R as "REPL JS runtime (in CLI process)"
    participant T as "Tools"
    S->>C: sendPrompt
    C->>M: request
    M-->>C: tool_use REPL with code
    C->>S: canUseTool REPL and PreToolUse REPL
    C->>R: run script
    par inner calls in the script
        R->>C: Bash, Read, mcp__x__y
        C->>S: canUseTool and PreToolUse under the tool's usual name
        C->>T: execute
        T-->>R: result stays in the script
    end
    R-->>C: compact return value
    C-->>S: REPL tool_result (code, result, stdout, toolsUsed)
    C->>M: one request with the compact result
    M-->>C: text
    C-->>S: result
```

Steps 4 and 7 on the Kanna side are **documented for settings-file hooks but unverified for SDK
callback hooks and `canUseTool`** (blocker B1).

Required decisions and constraints:

- **Eligibility** is computed once, from facts Kanna already has: provider `claude` (not `openrouter` or
  `custom`, which set `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`), a 5.5-or-later model, not
  path-confined, not a scheduled or background run that Code Mode refuses. Ineligible chats never pass
  the setting, so the CLI never prints a refusal mid-chat.
- **Stickiness:** a session started in Code Mode must always resume in Code Mode, and one started without
  it must stay without it [DOC]. The flag is therefore a property of the Claude session token, not of the
  chat's current preference. Switching mid-chat means `/clear` (new session), never an in-place toggle.
- **Model switches:** `setModel` is applied in place (`claude-session-spawner.ts:289`). Switching a Code
  Mode session to an unsupported model has unspecified behaviour [RE shows a "waitsForModel" re-check];
  Kanna should restrict the model picker for Code Mode sessions to eligible models.
- **Token pool rotation:** the binary has a `credential_changed` reason that restarts without Code Mode
  when the signed-in principal changes [RE]. If Kanna's pool hands a respawned session a token for a
  different account, the resume may be refused. Pin the pool token per Code Mode session, or test it.
- **Loop guard and inbox guard** must be proven to fire for inner calls (gate G2) before an armed loop or
  an inbox-driven turn may use Code Mode; until then, eligibility excludes those chats.
- **Rendering:** `REPL` maps to `unknown_tool` today. The minimum is a `code_program` tool kind showing the
  script collapsed, `toolsUsed`, and the returned value; inner calls render as rows nested under it only if
  the SDK stream carries them (unverified).
- **Hooks in user settings:** `settingSources` includes `user`, so a user's own `PreToolUse` hooks apply
  too; Code Mode changes their failure semantics (`onFailure`) [DOC].

Cost: small code surface (one option, one fingerprint field, one eligibility predicate, one tool kind),
but a high maintenance risk: experimental, undocumented for the SDK, changing every release, and a
one-way session property.

### 5.2 Option B: Kanna-built sandboxed program runner (provider-independent)

Shape: one new Kanna MCP tool (for example `mcp__kanna__run_program`) available to every provider that
can call Kanna's MCP server (Claude, Codex, Antigravity). The program runs in an isolate with no ambient
authority; its only capability is a `tools.call(name, args)` broker that sends each inner call through
Kanna's existing policy and approval door and records an audit event.

```mermaid
flowchart LR
    subgraph Model_side["Any provider session"]
        A["Model writes program"] --> P["mcp__kanna__run_program tool call"]
    end
    subgraph Kanna["Kanna server"]
        P --> G["Program gate: size, budget, chat policy"]
        G --> I["Isolate: no fs, no net, no env, no clock jitter"]
        I -- "tools.call(name, args)" --> B["Broker: one door per inner call"]
        B --> PG["policy.evaluate and approval (ToolCallbackService)"]
        PG -- allow --> X["Existing tool host: kanna MCP tools, read-only adapters"]
        PG -- ask --> H["Human approval card"]
        H --> X
        X --> AU["Audit event: programRunId, callId, args hash, result hash"]
        AU --> I
        I --> O["Bounded output to model"]
    end
```

What it needs that Kanna does not have:

- An isolation runtime. Bun has no built-in V8 isolate API with hard memory limits; candidates are a
  QuickJS-in-WASM interpreter, `isolated-vm` (native addon, Node-oriented), or a child process with OS
  sandboxing. Each is a new dependency with its own escape history.
- A broker that can reach the tools the model actually uses. The native CLI tools (Bash, Read, Edit)
  live inside the CLI process, not in Kanna; Option B could only call Kanna's own MCP tools and adapters
  Kanna implements again, which re-opens the shim layer #1516 deleted.
- Program-level budgets, partial-failure reporting, replay semantics and a nested UI, all new.

Benefit: provider-independent, Kanna owns the audit and approval per inner call, and the isolation can
be stronger than Claude Code's (which runs JavaScript and its file, web and MCP calls outside the shell
sandbox [DOC]).

Cost: a new deep subsystem with its own security perimeter, built to save tokens nobody has measured in
Kanna yet. It also competes with the model vendors' native features (Claude Code Code Mode, PTC), which
will keep improving.

### 5.3 Option C: hybrid

Native Code Mode where eligible, Option B elsewhere. It carries both implementations, two audit
vocabularies to reconcile and two failure surfaces, for a benefit that exists only if B is justified on
its own. Not recommended until then.

### 5.4 Comparison

| Criterion | Status quo | A: native passthrough | B: Kanna runner | C: hybrid |
| --- | --- | --- | --- | --- |
| Implementation size | none | small (option, fingerprint, eligibility, tool kind) | large (runtime, broker, budgets, UI, audit) | large plus small |
| Maintenance | none | high churn: experimental, undocumented SDK path | high: owned security perimeter | highest |
| Provider lock-in | none | Claude first-party only, 5.5+ models | none | mixed |
| Reaches native tools (Bash, Read, Edit) | yes | yes | no, Kanna MCP tools only | partly |
| Per-inner-call approval | none for Claude today | same as today, via rules and hooks if they fire | yes, Kanna owned | mixed |
| Audit per inner call | full, one row per call | REPL row plus `toolsUsed`; inner rows unverified | full, Kanna owned | mixed |
| Isolation of model-written code | n/a | JS outside the shell sandbox [DOC] | designed in | mixed |
| Resume and fork | proven | one-way session property, fork unverified | Kanna owned | both |
| Expected token and latency win | baseline | unmeasured in Kanna; vendor examples 0 to 98.7 % | unmeasured, plus Kanna overhead | unmeasured |
| UX | familiar row per call | fewer rows, code hidden unless expanded | new nested program card | two shapes |

## 6. Threat model and invariants

Assets: the user's repository and machine, credentials (pool tokens, MCP bearers, vault-brokered keys),
external accounts reached through MCP (GitHub, Slack, inbox channels), and the integrity of the audit
trail.

Adversaries: prompt injection in tool output (web pages, issues, MCP results, inbox messages); a
model that writes wrong or over-broad code; a malicious or compromised MCP server.

New risks that programs add:

| Threat | Why programs change it | Invariant | Control (A) | Control (B) |
| --- | --- | --- | --- | --- |
| Approval bypass | Many calls per approval, or calls hidden inside one script | Every side-effecting inner call meets the same gate as a direct call, under its own name | Prove G2; deny `REPL` in chats where hooks are the boundary until proven | Broker is the only capability; no batch approvals |
| Privilege escalation through JS | JS reaches fs, net, env directly | Program code has no ambient authority beyond its tool broker | Not satisfiable: Claude Code runs JS and its file, web and MCP calls outside the sandbox [DOC]; needs a container or VM | Isolate with no fs, net, env |
| Secret exfiltration | Code can read a token and pass it to another call; telemetry can log it [DOC] | Credentials never enter model-visible or program-visible data | Keep `OTEL_LOG_TOOL_DETAILS` unset; `PostToolUse` redaction; secrets stay vault-injected | Bindings hold credentials, as in Cloudflare's design |
| Destructive actions without human sight | A script can delete after a run-time-computed search | No hidden destructive action; no auto-approval of destructive tools | Kanna's acceptEdits plus allow-all `canUseTool` already allows this for direct calls; Code Mode removes the row-per-call visibility, so require inner-call rows (G3) | Destructive tools require per-call approval |
| Runaway cost and resources | Loops, fan-out, large outputs | Bounded time, memory, call count, concurrency and output bytes | CLI limits: 10 min foreground, memory stop, output cut with a path to the full text [DOC, CHANGELOG] | Explicit budgets per run |
| Partial failure | Script dies after some side effects | Side effects that finished are reported, never silently retried | Finished calls stay applied after Esc [DOC]; the model must be told | Per-call journal; non-idempotent calls never auto-retried |
| Replay and resume | Restarted turn reruns side effects | Resume never re-executes a finished side effect | CLI resume drops script variables and tells the model [CHANGELOG] | Journal keyed by (programRunId, callIndex, argsHash), the ToolCallbackService dedup pattern |
| Untrusted output steering code | Injected text changes run-time branches the classifier never saw [DOC] | Tool output is data, never code | Rules and hooks on calls, not on code | Program cannot `eval` tool output |
| Audit loss | One REPL row hides N calls | Every inner call has an event with correlation id and provenance | Depends on G3 | Built in |

Non-negotiable invariants for any rollout: no hidden destructive action; no auto-approval introduced by
Code Mode beyond what the chat already allows; every inner call attributable to its program run and
chat; cancel stops the program and reports what already ran; a turn that cannot resume in its original
mode fails visibly, never silently starts a fresh session.

## 7. Benchmark methodology

Goal: decide with data whether Code Mode reduces context, latency and orchestration cost in Kanna's
workloads without hurting correctness, approval parity or audit parity.

Design:

- **Arms:** baseline (Code Mode off) vs Code Mode (on via `settings.env`). Same pinned SDK and CLI, same
  model (`claude-opus-5-5` primary, `claude-haiku-5-5` secondary), same effort, same system prompt
  (Kanna's preset append), same tool set, same MCP servers, same working tree, `settingSources: []` or a
  fixed settings file, `permissionMode` identical.
- **Caching:** each task runs cold (first run in a fresh session after more than one hour, so the 1-hour
  ephemeral cache is gone) and warm (repeat within five minutes). Report them separately; never average
  cold with warm.
- **Repetitions:** at least 10 runs per arm, task and cache state; alternate arm order to cancel drift.
- **Metrics per run** (from the SDK `result` and the stream): `input_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens`, `output_tokens`, thinking tokens, `num_turns`, count of distinct
  assistant message ids (model round trips), tool calls by name (inner and outer), REPL calls, wall time,
  `duration_api_ms`, cost at list price, permission prompts raised, hook invocations recorded, and errors.
- **Correctness:** each task has a machine-checkable answer (exact set match or a scored rubric); report
  exact-match rate and partial precision/recall.
- **Parity checks:** a scripted `PreToolUse` callback hook and `canUseTool` log every invocation; for
  each inner call seen in OpenTelemetry (`repl_` and `toolu_cc_` ids) or in `toolsUsed`, check that the
  hook and the audit log saw it too. Any inner call the hook did not see fails the arm regardless of
  savings.
- **Statistics:** report p50 and p95 per metric with bootstrap 95 % confidence intervals for the
  difference of medians. A saving counts only if the interval excludes zero and correctness does not drop.

Tasks (all read-only):

1. **Synthetic link audit** (Appendix B dataset): 40 Markdown files, 13 broken local links.
2. **Multi-file repo audit:** "list every `*.adapter.ts` in `src/server` with the exported functions
   that touch `process.env`", answer generated by a script on the same tree.
3. **Cross-session research on authorized data:** a fixture copy of synthetic Kanna transcripts (never
   real user chats without consent): "which chats used tool X more than N times", answer from `jq`.
4. **Read-only MCP fan-out:** a local synthetic MCP server with 30 tools returning deterministic JSON
   (for example 500 issues), task "issues labelled bug, opened in month M, with no linked PR".
5. **Sequential control task:** a chain where each call depends on reasoning about the previous result
   (PTC's weak-fit case), to detect regressions.

Reporting rule: no extrapolation from Anthropic's examples; publish per-task numbers only.

## 8. Risk register

| Id | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| B1 | SDK callback hooks or `canUseTool` do not fire for some inner calls | unknown | high (inbox and loop guards bypassed) | Gate G2 before any user exposure |
| R2 | Undocumented SDK path changes or is removed | high | medium | Server env var, off by default; pin the SDK; re-run the gates on each SDK bump |
| R3 | Code Mode session cannot resume after the flag, model or credential changes | medium | high (chat stuck) | Flag bound to session token; restrict models; pin pool token; visible failure |
| R4 | Inner calls invisible in the transcript | medium | medium (audit and UX) | Gate G3; otherwise render `toolsUsed` and keep the REPL code expandable |
| R5 | JS and its file, web and MCP calls run outside the shell sandbox | certain [DOC] | medium | Exclude path-confined and inbox chats; recommend container deployment for Code Mode |
| R6 | Token savings smaller than overhead on Kanna workloads | unknown | low | Benchmark first; ship only on a measured win |
| R7 | Pool token rotation triggers `credential_changed` | medium [RE] | medium | Pin a token per Code Mode session; test |
| R8 | Code Mode bugs (lost replies, stalls) degrade long chats | medium [CHANGELOG] | medium | Dev-only spike; keep the status quo as default |
| R9 | Option B isolation escape | medium | high | Do not build B without a dedicated security review |

## 9. Rollout, rollback and phases (proposal, not authorized)

**Opt-in shape:** off by default; a server-level environment variable (for example
`KANNA_CLAUDE_CODE_MODE=1`, name to be confirmed with the wiki env-var list) enables eligibility; then a
per-chat choice at chat creation. Never applied to an existing session. **Rollback:** unset the
variable; new sessions start without Code Mode; existing Code Mode sessions keep resuming in Code Mode
until `/clear`, because the CLI refuses to resume them otherwise. A managed-settings `0` blocks it
everywhere [DOC].

| Phase | Work | Acceptance gate |
| --- | --- | --- |
| P0 (done) | Source verification, gate probe, harness | This report |
| P1 | Unblock auth (user runs `claude auth login` in a terminal); run Appendix B on SDK 0.3.332 | G1: `REPL` in init tools; a script runs end to end; resume with the flag works and without it fails visibly |
| P2 | Parity spike in the harness: callback `PreToolUse` and `canUseTool` logging, a deny rule for `Bash(git push *)` | G2: 100 % of inner calls seen by the callback hook and by `canUseTool` when it would ask; deny honoured inside scripts. G3: the stream form of inner calls documented |
| P3 | Benchmark (section 7) | Measured saving with confidence intervals on at least three tasks, correctness not lower, approval and audit parity 100 % |
| P4 | Kanna dev-instance spike behind the server variable: `settings` option, fingerprint, eligibility, `code_program` tool kind | `bun run check`, focused tests on the public seam (eligibility and resume stickiness), manual golden path; c3 change and ADR |
| P5 | Limited opt-in for the owner's chats | Two weeks without stuck resumes or parity failures |

## 10. Open decisions needing human approval

1. May the benchmark use a real Anthropic login (subscription usage), and on which account? It needs a
   working `claude auth login`; Kanna pool tokens were not used.
2. Is an undocumented Agent SDK path acceptable for a dev-only spike (P4), or must Kanna wait for
   Anthropic to document SDK support?
3. Should Code Mode chats be allowed to run with Kanna's allow-all `canUseTool`, or must per-call
   approval for destructive tools (Bash writes, Edit outside the repo, side-effecting MCP tools) land
   first, for Code Mode and direct calls alike?
4. Which chats are excluded by policy: inbox-driven, loop-armed, path-confined, cron, subagents?
5. Is a container or VM deployment a precondition for Code Mode, given the sandbox gap [DOC]?
6. Whether Option B is ever wanted for Codex and Antigravity sessions, which would need its own
   measurement first.

## 11. Documentation and code disagreements found

- The public Code Mode page restricts the surface to an interactive terminal; the 2.1.332 changelog and
  binary support `claude -p` and the Agent SDK through the `settings` option.
- The Code Mode requirements say v2.1.323+; Kanna's pinned SDK 0.3.330 ships 2.1.330, while the local
  stale `main` checkout pins 0.3.312 (2.1.312), which has no Code Mode at all.
- Kanna docs: `security-sandboxing.md` and the `kanna-sessions` skill describe a 600 s approval timeout
  that the code does not implement (`tool-callback.ts:49` uses `NEVER_EXPIRES`); the `kanna-providers`
  skill names an older bundled CLI version. Follow-ups, out of scope here.

## Appendix A: Sources

- https://code.claude.com/docs/en/code-mode
- https://code.claude.com/docs/en/tools-reference (REPL row)
- https://code.claude.com/docs/en/env-vars (`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE`)
- https://code.claude.com/docs/en/agent-sdk/typescript (`env` and `settings` options)
- https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md (2.1.323 to 2.1.332)
- https://www.anthropic.com/engineering/code-execution-with-mcp
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling
- https://blog.cloudflare.com/code-mode/
- npm `@anthropic-ai/claude-agent-sdk@0.3.332` (`claudeCodeVersion` 2.1.332), binary strings [RE]

## Appendix B: Reproducible probe and benchmark harness

Prerequisites: a valid first-party login (`claude auth login` in a terminal), Node 22+, a scratch
directory. Nothing here changes Kanna or global settings.

```bash
mkdir -p /tmp/cm-sdk-pkg /tmp/cm-probe-work/docs /tmp/cm-probe-scripts
cd /tmp/cm-sdk-pkg && echo '{"private":true}' > package.json
npm install --ignore-scripts @anthropic-ai/claude-agent-sdk@0.3.332
```

Dataset generator (run with `bun -e` from `/tmp/cm-probe-work`): 40 files `docs/page-NN.md`, each linking
to four other pages as `../docs/page-MM.md` with `MM = (i*7 + k*3) mod 40`, plus `../docs/missing-i.md`
when `i mod 5 = 0` and `../assets/img-i.png` when `i mod 9 = 0`; 13 broken links in total; ground truth
written to `/tmp/cm-probe-scripts/ground-truth.json` as root-relative `{file, target}` pairs.

Probe (`/tmp/cm-probe-scripts/probe.mjs`), essentials:

```js
import { query } from "/tmp/cm-sdk-pkg/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs";
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([k]) => !/^(CLAUDE|CLAUDECODE|ANTHROPIC)/.test(k)));
const options = {
  cwd: "/tmp/cm-probe-work", model, env, settingSources: [], permissionMode: "default",
  canUseTool: async (toolName, input, { toolUseID }) => { /* log; allow read-only tools only */ },
  hooks: { PreToolUse: [{ hooks: [async (i) => { /* log i.tool_name, i.tool_use_id */ return {}; }] }] },
};
if (codeMode) options.settings = { env: { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "1" } };
for await (const m of query({ prompt, options })) { /* record init.tools, tool_use, tool_result,
  system notifications (key "code-mode-opt-in"), result.usage, num_turns, durations */ }
```

The `hooks` logger is the parity check for gate G2; the run used in section 3 did not yet include it.
