# OpenRouter Provider (SDK mode) — Design

Date: 2026-06-18
Status: approved
Branch: `feat/openrouter-provider`

## Goal

Add OpenRouter as a first-class chat provider alongside `claude` and `codex`,
so users can drive a full agentic coding session against any tool-capable
OpenRouter model. SDK mode only.

## Key insight

OpenRouter officially supports the Anthropic Claude Agent SDK
(https://openrouter.ai/docs/guides/community/anthropic-agent-sdk) via env vars.
Kanna already uses `@anthropic-ai/claude-agent-sdk` for its `claude` provider,
so OpenRouter does NOT need a custom agent loop. We redirect the SAME SDK to
OpenRouter's endpoint. Result: full tool-call parity, MCP, streaming,
multi-turn, subagents — all unchanged, because it IS the Claude Agent SDK.

## Architecture

Provider picker becomes a 3-way peer choice: **claude · codex · openrouter**.

```
AgentProvider = "claude" | "codex" | "openrouter"
```

When a chat's provider is `openrouter`, the turn flows through the existing
Claude SDK path (`startClaudeSession` → `query()`), with exactly three deltas:

1. **Env injection** (`buildClaudeEnv`, gated on provider):
   ```
   ANTHROPIC_BASE_URL  = "https://openrouter.ai/api"
   ANTHROPIC_AUTH_TOKEN = <openrouter apiKey>
   ANTHROPIC_API_KEY    = ""        # MUST be explicitly empty
   ```
   and strip `CLAUDE_CODE_OAUTH_TOKEN` (OpenRouter never uses the OAuth pool).

2. **Model** — the selected OpenRouter slug (e.g. `anthropic/claude-sonnet-4`,
   `moonshotai/kimi-k2.5:nitro`) is passed raw to `query({ model })`, bypassing
   Claude model normalization (`normalizeServerModel`).

3. **Auth source** — OpenRouter API key read from existing
   `~/.kanna/llm-provider.json` (provider/apiKey/model/baseUrl). Already stored,
   validated, has Settings UI. No new credential infra. The key is used when
   `llm-provider.json.provider === "openrouter"` and `enabled === true`.

### Provider modeling

The ~20 `provider === "claude"` checks in `agent.ts` that gate the Claude SDK
session machinery become a single helper:

```ts
function isClaudeSdkProvider(p: AgentProvider): boolean {
  return p === "claude" || p === "openrouter"
}
```

Session-management spots (session map keying, idle reaper, driver selection)
use the helper. `chat.provider` persists `"openrouter"` like any other.

PTY OpenRouter is OUT OF SCOPE — SDK mode only. If the driver preference
resolves to `pty` for an openrouter chat, fall back to SDK for that provider.

## Model picker (dynamic, fetched)

OpenRouter models are fetched live, not hard-coded:

- **Adapter** `src/server/openrouter-models-io.adapter.ts` — the only IO.
  `fetch("https://openrouter.ai/api/v1/models")` (public, no auth), parse to
  `{ id, name, contextLength }[]`, **filter to tool-capable** models
  (`supported_parameters` includes `"tools"`). In-memory cache with ~1h TTL +
  on-disk fallback under `~/.kanna/cache/openrouter-models.json`.
- **RPC** `settings.listOpenRouterModels` → returns the cached/fetched list.
  Client populates a searchable dropdown (the list is large).
- **Catalog** the `openrouter` entry in the provider catalog has an empty
  static `models` array (filled at runtime by the fetch) and
  `defaultModel = DEFAULT_OPENROUTER_SDK_MODEL`.

## Data flow

1. User picks `openrouter` + a model in the composer → `chat_send` persists
   `provider: "openrouter"`, `model: "<slug>"`.
2. `AgentCoordinator.startTurn` → `authReady("openrouter")` checks
   `llm-provider.json` has an OpenRouter key + `enabled`. Missing →
   `AUTH_REQUIRED` transcript error linking to Settings.
3. `startClaudeSession` builds OpenRouter env, calls `query({ model: slug })`.
4. Stream → existing `normalizeClaudeStreamMessage` → `HarnessEvent` →
   transcript. Tool calls → existing approval flow, unchanged.

## Error handling

- **401 / 402** (bad key / no credits): surface through the existing
  `detectFromResultText` path as a turn error. NO OAuth-pool rotation —
  OpenRouter is a single key, not a pool.
- **404 model**: "model unavailable on OpenRouter" turn error.
- **Model-list fetch failure**: picker shows the cached list, or
  `DEFAULT_OPENROUTER_SDK_MODEL` only, with a non-blocking warning.
- **AUTH_REQUIRED**: no key configured → transcript error with a link to
  Settings → provider keys.

## Testing

- `provider-catalog.test.ts` — openrouter catalog entry present;
  `isClaudeSdkProvider` helper correctness.
- `agent.test.ts` — `buildClaudeEnv` openrouter branch sets/strips the right
  vars (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY=""`,
  no `CLAUDE_CODE_OAUTH_TOKEN`); `authReady("openrouter")` gating.
- `openrouter-models-io.adapter.test.ts` — parse + tool-capable filter + cache
  TTL behavior (injected clock + fetch; NO live network).
- Parity — an openrouter turn produces the same `HarnessEvent` sequence as a
  claude turn given identical SDK fixtures.
- CI makes NO live OpenRouter calls (fetch + SDK injected).

## Out of scope

- PTY driver OpenRouter support.
- OAuth-pool storage of OpenRouter keys (single key in llm-provider.json).
- Per-model pricing/cost display in the picker (future enhancement).
- Non-tool-capable models (filtered out).

## C3 impact

- `c3-212` (provider-catalog): add openrouter entry, dynamic model source.
- `c3-2` Server: new component `openrouter-models` adapter (read-model style,
  independent fetch — does not touch the event pipeline).
- `ref-provider-adapter`: openrouter is a thin re-use of the Claude SDK
  adapter, not a new transport. Document the env-redirect pattern.
- ADR required before implementation (C3 change op).
