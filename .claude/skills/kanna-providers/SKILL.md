---
name: kanna-providers
description: Model and provider catalog in Kanna — customModels and mergeCustomModels, the 1M context-window option, custom Anthropic-compatible endpoints (the custom provider, resolveSdkEndpoint, endpointSpawnFingerprint, model alias env vars, contextWindow), Codex failure classification (codexErrorInfo, willRetry), and the Antigravity provider (agy over ACP, AntigravityAcpManager, the agent-tools bridge). Use whenever a task touches PROVIDERS, provider-catalog, Settings → Models or Providers, sdk-endpoint, a wrong or downgraded model or context window, an Ollama/GLM/Qwen endpoint, a Codex turn that failed or offered Retry, or an agy or Antigravity chat that fails to start, resume or reach Kanna's peer tools.
---

# Kanna providers and models

## Configurable Model Catalog (customModels)

Claude + Codex models are user-configurable from Settings → "Models" instead
of being hardcoded. Entries persist in `settings.json` under `customModels`
(seeded on first load from the built-in `PROVIDERS` list) and merge into the
effective catalog at read time.

- **Single source of truth.** `PROVIDERS` in `src/shared/types.ts` is the only
  built-in catalog. `src/server/provider-catalog.ts` `SERVER_PROVIDERS` is
  `[...PROVIDERS]`; a second hardcoded list drifts from it.
- **Merge.** `mergeCustomModels(base, customModels)` (pure, in `types.ts`)
  makes the Settings list **the** catalog for a provider that has entries: the
  chat offers exactly the listed models, in list order, and a built-in the list
  omits is not offered. Each listed id that ships as a built-in inherits that
  built-in's fields. A provider with no entries falls back to the built-ins, so
  the catalog is never empty, and `defaultModel` moves to the first listed model
  when the built-in default is not listed. `normalizeProviderModelId` resolves a
  selection of a removed model to a listed one rather than the built-in default.
  A model deleted in Settings therefore disappears from the chat picker.
  **An override MERGES per field, it does not replace the object.** The Settings
  form collects only id/label/efforts, so a replacing override of an id that
  ships as a built-in would strip every capability it cannot declare: a
  hand-added `claude-opus-5` would lose `contextWindowOptions`, hide the 1M
  toggle and pin every turn to 200k, visible only as a `runConfig.model` with no
  `[1m]` suffix and auto-compaction at ~168k. There is no "explicitly none" to
  preserve: `applyCustomModelPatch` collapses a cleared field to `undefined`,
  indistinguishable from never-set.
- **A downgraded context window is logged, never silent.**
  `normalizeClaudeModelOptions` warns when the requested window is not the
  resolved one. The window is a 5x difference in usable context and nothing else
  in the system reports the substitution.
- **The Models editor always records the context-window choice explicitly.**
  `ModelsSection` pre-fills its "Offer the 1M context window" checkbox from
  `effectiveContextWindowOptions` — the entry's own options, else the built-in's,
  the same fallback the merge applies — and writes `["200k","1m"]` or `["200k"]`
  on save. Pre-filling from the DECLARED options instead would tick the box off
  for an entry that was inheriting, and the save would write the inheritance
  away.
- **Seeding, and why a deletion sticks.** `normalizeModelCatalog`
  (`app-settings.ts`) seeds `customModels` from built-ins (deterministic
  `createdAt/updatedAt = 0`) when the persisted value is absent, making every
  built-in an editable copy in the UI. `seededBuiltinModels` (file-only, never
  in the snapshot) records each `provider:id` ever offered. A built-in missing
  from that record — one a later release shipped — is appended to the list
  once. A deleted model is still in the record, so it is never re-added. A file
  that predates the record is treated as having been offered every current
  built-in, because its missing built-ins are deletions the user already made.
  The cost: a built-in shipped after such a file was seeded stays hidden until
  the user adds its id, which restores its built-in fields.
- **CRUD.** `AppSettingsPatch.customModels` carries `create | update | delete`,
  handled by the settings reducer (mirrors `customMcpServers`), validated by
  `validateCustomModelShape` (id regex, non-empty label, provider ∈
  {claude,codex}, dedupe per provider). Rides the existing
  `handleWriteAppSettings` RPC — no new endpoint.
- **Transport.** `deriveChatSnapshot` (`read-models.ts`) emits
  `availableProviders: mergeCustomModels([...SERVER_PROVIDERS], customModels)`
  (customModels threaded from `AppSettingsManager` at the `ws-router.ts` call
  site) — the per-chat snapshot is the single server→client catalog transport.
  `normalizeServerModel(provider, model, customModels)` accepts custom ids at
  turn time. Client: `selectCustomModels` selector (stable `EMPTY` ref) +
  `ModelsSection.tsx` CRUD UI; the Settings-page default-model pickers derive
  `mergeCustomModels([...PROVIDERS], customModels)`. Both `mergeAppSettingsPatch`
  copies (client store + `ws-router` fallback) pin `customModels` so the CRUD
  patch shape never leaks over the array.
- **Scope.** OpenRouter untouched (already dynamic via API). Built-in
  providers are not add/removable — models only. Anthropic-compatible
  endpoints are added through **Custom endpoints** below.

## Custom endpoints — the `custom` provider (customProviders)

Users register Anthropic-compatible endpoints (GLM, Qwen, Kimi, DeepSeek,
MiniMax, anything) in Settings → Providers. They run through the Claude SDK
exactly like OpenRouter. ADR `adr-20261012-custom-anthropic-endpoints`.

- **One fixed provider literal, not one id per endpoint.** `AGENT_PROVIDERS`
  gained `"custom"`, and the endpoint rides the MODEL id:
  `<providerId>/<vendorModel>` (`encodeCustomModelId` / `parseCustomModelId`,
  `src/shared/custom-providers.ts`, split on the FIRST `/`). Per-endpoint
  provider ids were rejected: ~60 sites branch on the closed union and most
  fall back to Codex silently for an unknown value, so a missed branch is
  invisible. Do not widen `AgentProvider` to a template-literal type.
- **`withCustomProviders` fills the `custom` catalog entry and REMOVES it when
  no endpoint is configured.** Apply it wherever a provider list is built
  (`deriveChatSnapshot`, `useProviderCatalog`, Subagents), or an empty "Custom
  endpoints" provider appears.
- **`resolveSdkEndpoint` (`src/server/sdk-endpoint.ts`) is the single owner of
  endpoint resolution for `openrouter` AND `custom`.** `buildClaudeEnv` takes a
  generic `SdkEndpointEnv` (`{baseUrl, apiKey, aliasModel, contextWindow}`); never re-hardcode an endpoint there. The SDK gets
  `vendorModel` on both `query` and `setModel`, while `session.model` keeps the
  Kanna-level id.
- **`endpointSpawnFingerprint` is part of the respawn condition**
  (`spawnClaudeTurn`, `session.endpointFingerprint`). It covers everything baked
  into the process env at spawn: endpoint key, base URL, API key, alias model and
  context window. So a GLM→Qwen switch, a model switch WITHIN one custom endpoint
  (the aliases must follow — two local Ollama models resident at once can exceed
  GPU memory), and an endpoint edited in Settings all respawn with `--resume`,
  keeping history. OpenRouter's alias model is `null`, so its model switches
  still use in-place `setModel`. The fingerprint holds the key: compare it,
  never log it — `endpointKey` is the loggable identity.
- **The API key is WRITE-ONLY.** The file holds `CustomProviderEntry` (with
  `apiKey`); `toSnapshot` maps to `CustomProviderPublic` (only `apiKeyHint`).
  The spawner reads the key via `AppSettingsManager.getCustomProviderCredential`.
  Writes are CRUD only (`AppSettingsPatch.customProviders` create/update/delete);
  an update with a blank key keeps the stored one. Never accept a whole
  `customProviders` array from the client — the redacted snapshot would
  overwrite every key.
- **The composer treats `custom` like `openrouter`** through
  `isEndpointProvider` (`provider-model-types.ts`): empty `modelOptions`, the
  searchable model picker, no effort / context-window / fast-mode controls.
  Branch on the predicate, not on `=== "openrouter"`, so the two cannot drift.
- **Claude model names are mapped onto the endpoint's model — custom ONLY.** The
  CLI makes background and subagent calls under Claude ids, and a non-Claude
  endpoint answers `not_found_error: model 'claude-haiku-4-5-20251001' not
  found` (Ollama). `SdkEndpoint.aliasModel` is the vendor model for `custom` and
  `null` for `openrouter`, which serves real Claude ids and must not change;
  `buildClaudeEnv` sets all six variables the bundled CLI reads —
  `ANTHROPIC_DEFAULT_FABLE_MODEL`, `_OPUS_`, `_SONNET_`, `_HAIKU_MODEL`,
  `ANTHROPIC_SMALL_FAST_MODEL` (checked first for the background model) and
  `CLAUDE_CODE_SUBAGENT_MODEL` (`CLAUDE_MODEL_ALIAS_ENV_VARS`). Both spawn
  paths go through `resolveSdkEndpoint` and hand `endpointEnvOf(endpoint)` to
  `buildClaudeEnv`. Env is fixed at spawn, which is why a model switch on a
  custom endpoint respawns rather than calling `setModel` (see the fingerprint).
- **`contextWindow` (per endpoint, 4096..2,000,000 tokens, optional) becomes
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS`.** For an id not starting with `claude-` the
  CLI assumes a 200000 window unless that variable is set, and only then
  does auto-compaction keep the session inside the real window. Do NOT use
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW`: it clamps to a 100k minimum, so a 64k Ollama
  model would never compact in time. The same number is Kanna's own meter
  (`contextWindowOverride`, on the main spawner and the subagent path), so the
  composer shows 65k rather than 200k. Not secret, so it is in
  `CustomProviderPublic`; a patch of `null` clears it, an invalid stored value is
  dropped with a warning and the entry kept. Presets may carry `contextWindow` and
  a non-secret `defaultApiKey` (only Ollama, which ignores the key).
- **No pricing, and the CLI's guess is discarded.** The CLI still returns a
  `total_cost_usd` for an unknown model, priced on a guess and marked
  `modelUsage[model].costBasis: "unknown"` (values: `list`, `managed`,
  `unknown`) — measured $0.047 for one small turn on a free local Ollama model.
  `createClaudeHarnessStream` ignores the SDK cost whenever any model is
  `unknown` (`modelUsageHasUnpricedModel`) and falls back to the turn price
  resolver, else reports no cost. This also makes OpenRouter turns use
  OpenRouter's real per-token price instead of the CLI's guess.
- `normalizeSubagentEntry` and `normalizeDefaultProvider` accept every
  `AgentProvider`.

## Codex Failure Classification (`codexErrorInfo` + `willRetry`)

A failed Codex turn carries a machine-readable reason, not just prose. Kanna
reads both fields the app-server sends and stops guessing from error strings.

**Regenerate the protocol truth, never infer it.** `codex app-server
generate-ts --out <dir>` emits the authoritative bindings; `v2/TurnError.ts`
and `v2/CodexErrorInfo.ts` are the source for
`src/shared/codex-error-classification.ts`. The app-server exposes these in
**camelCase** (`codexErrorInfo`, `serverOverloaded`); the snake_case spellings
in Codex's own rollout JSONL under `~/.codex/sessions/**` are a DIFFERENT,
internal format. Reading the rollout and typing the wire from it produces a
field that never matches — check the generated bindings.

- **One classification table.** `CODEX_ERROR_TAGS` maps every variant to its
  `failureClass` (`transient | quota | auth | fatal | unknown`), its wire
  `shape` and its user-facing `describe`; `CodexErrorInfoTag` is derived
  from that table's keys, so a variant cannot be classified without existing.
  An unknown or absent tag classifies `unknown`, **never** `transient` — a
  future variant must not silently earn a retry affordance.
- **Two readers, deliberately asymmetric.** `codexErrorInfoTag` parses the WIRE
  and rejects an object variant spelled as a bare string. `classifyCodexFailure`
  / `isRetryableCodexFailure` / `describeCodexFailure` take
  `CodexFailureInput = CodexErrorInfo | CodexErrorInfoTag`, because they also
  read back the already-flattened tag Kanna persisted itself. Collapsing the two
  makes an object variant (`responseStreamDisconnected`, `httpConnectionFailed`,
  `activeTurnNotSteerable`) classify `unknown` on the round trip.
- **Transport carries facts, UI owns wording.** `handleTurnCompleted` /
  `failContext` put the flattened tag on `ResultEntry.codexErrorInfo` and leave
  `result` as the provider's raw sentence. `ResultMessage` renders
  `describeCodexFailure(...)` and offers **Retry** only when
  `isRetryableCodexFailure`. No description for a tag → the raw sentence still
  shows, so an unmapped variant degrades to today's behaviour.
- **The retry callback must stay reference-stable.** `handleRetryFailedTurn`
  reaches every memoized transcript row and the row comparator checks its
  identity, so it reads `messages` + the submit fn through a ref and keeps `[]`
  deps. Depending on `state.messages` directly re-renders the whole transcript
  on every streamed chunk.

**`willRetry` is load-bearing — do not drop it again.** `ErrorNotification`
carries `{error, willRetry}`. `willRetry: true` means Codex is reconnecting on
its own and the turn is STILL LIVE; `handleNotification` must return without
calling `failContext`. Failing the turn there kills one that would have
recovered — it surfaced to users as a turn dying with the literal text
`Reconnecting... 1/5`. Absent `willRetry` (older app-server) reads as terminal.
Trade-off accepted: a `willRetry: true` never followed by a terminal event
leaves the turn hanging where it previously failed fast; Codex bounds its own
retries and Stop still works.

Not wired: `quota` (`usageLimitExceeded`) does not arm auto-continue —
`CodexErrorInfo` carries no reset timestamp, so that needs Codex's separate
`rate_limits` event. `CodexLimitDetector` still only fires on a THROWN stream
error (`claude-turn-runner.ts` catch branch); a `turn/completed` failure never
reaches it, which is why c3-227's documented precondition ("a Claude or Codex
turn emits a result event with subtype: error") is still only half true.

## Antigravity (`agy` over ACP)

The fifth provider runs Google's `agy` CLI (v1.5.9+) as an Agent Client Protocol
server on stdio. c3 component `c3-250`, ADR `adr-20261117-antigravity-acp-provider`
(why ACP, why auto-approve, why an HTTP MCP bridge). User docs:
`wiki/src/content/docs/features/providers-models.mdx`.

**Where it lives**

- `src/server/antigravity-acp.ts` `AntigravityAcpManager`: one `agy` child per
  chat (scope `main`) or subagent run (scope `sub:<runId>`), the counterpart of
  `CodexAppServerManager`. `antigravity-acp-protocol.ts` decodes ACP envelopes,
  `antigravity-acp-translator.ts` maps `session/update` onto transcript entries.
- `src/server/antigravity-spawn.adapter.ts` is the only spawn site:
  `agy acp --dangerously-skip-permissions`. `src/server/stdio-process.ts` is the
  `StdioProcess` port Codex and Antigravity share, and
  `src/server/test-helpers/fake-acp-process.ts` is the fake the tests drive.
- Wiring: `claude-turn-starter.ts` (turn start), `claude-send-command.ts`
  (`/compact` passthrough via `providerCompactsNatively`), `subagent-provider-run.ts`
  (`runAntigravitySubagent`), `peer-messaging/create-peer-messaging.ts`
  (constructs the manager and the bridge). Catalog and defaults live in
  `src/shared/provider-model-types.ts` and `src/shared/settings/provider-defaults.ts`.

**ACP facts that are easy to get wrong**

- Developer instructions go in `session/new` as `_meta.antigravity.systemPrompt.append`
  and persist across resume; `session/resume` falls back to `session/new` when agy
  no longer has the session (`isRecoverableResumeError`).
- Model and thinking level are `session/set_config_option`; plan mode is
  `session/set_mode`. The plan document is the `write_file` artifact whose
  `ArtifactMetadata.RequestFeedback` is true, proposed through `ExitPlanMode`.
- Cancel is `session/cancel`. `/compact` is passed through (agy compacts natively).
- No fork (a fork starts a new session), no steering (peer and queued messages wait
  for the turn to end, `mid-turn-delivery.ts` returns false), no custom models,
  no fast mode, no context-window picker, no `keep_alive` subagents.
- Approvals are auto-granted by the spawn flag, parity with Codex `approvalPolicy: "never"`.
  Do not add a permission card without revisiting the ADR.
- `ask_question` arrives as plain text; `list_dir`, `grep_search` and `find_by_name`
  render as generic tool entries.
- Effort is `low | medium | high`, default `medium`; default model `gemini-4-carbon`.

**Peer tools bridge** (`src/server/agent-tools-bridge.ts`). Codex gets
`list_peer_chats`, `send_chat_message` and `wait_for_chat_message` as in-process
`dynamicTools`; ACP has no such channel, so agy gets them as an HTTP MCP server at
`AGENT_TOOLS_MCP_PATH` (`/agent-tools/mcp`), mounted in `http-dispatcher.ts` after
remote MCP. Invariants a change must keep:

- A random 32 byte bearer per main session maps to its chat id; the manager passes
  it in `mcpServers` headers on `session/new` and `session/resume`, and revokes it
  on `stopSession` and on failure. Subagent scopes get no grant.
- Only direct loopback POSTs: no `Origin`, `Forwarded`, `X-Forwarded-*`, `X-Real-IP`
  or `CF-Connecting-IP` header. Otherwise 403; non-POST 405; missing, unknown or
  revoked bearer 401; the OAuth discovery path 404 (agy must not start an OAuth flow).
- `server.timeout(req, 0)` per request so `wait_for_chat_message` can hold it open.
- agy reports no result for MCP calls, so the bridge outcome is recorded as the
  `tool_result` of the agy tool call, also when the HTTP call lands before the ACP
  `tool_call`.

**Run it locally.** Install `agy` and log in (`agy` once, or `agy acp --login`), start
`bun run dev`, pick Antigravity in the composer. Unit tests need no agy; they drive the
fake ACP process: `bun run test src/server/antigravity-acp.test.ts
src/server/agent-tools-bridge.test.ts`. Debug a stuck chat with `kanna-debug`; the
stored session token is the agy session id.
