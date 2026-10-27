---
id: rule-mcp-name-reserved
c3-seal: 3d0e7f0da6a97bd7ccf91bbe86d5c06f02e95579a3472dcb1c5f78348b728a94
title: mcp-name-reserved
type: rule
goal: |-
    User MCP server names registered in `customMcpServers` must never equal
    `KANNA_MCP_SERVER_NAME` ("kanna"). Enforced at storage and in the SDK session
    build so the Kanna-internal MCP tool surface is never shadowed or overwritten
    by a user-supplied server.
---

# mcp-name-reserved

## Goal

User MCP server names registered in `customMcpServers` must never equal
`KANNA_MCP_SERVER_NAME` ("kanna"). Enforced at storage and in the SDK session
build so the Kanna-internal MCP tool surface is never shadowed or overwritten
by a user-supplied server.

## Rule

User MCP server names registered in `customMcpServers` must never equal
`KANNA_MCP_SERVER_NAME` ("kanna"). Enforced at storage (`validateMcpShape`)
and in the SDK session build (`buildUserMcpServers` filter).

## Golden Example

```ts
// src/shared/settings/validation.ts
export const MCP_RESERVED_NAMES: ReadonlySet<string> = new Set(["kanna"])

export function mcpServerNameIssue(name: string): McpServerNameIssue | null {
  if (!MCP_SERVER_NAME_PATTERN.test(name)) return "INVALID_NAME"
  if (MCP_RESERVED_NAMES.has(name)) return "RESERVED_NAME"
  return null
}
```

```ts
// src/server/claude-session-config.ts
export function buildUserMcpServers(servers: readonly McpServerConfig[], oauthBearers = new Map()) {
  const out: Record<string, SdkMcpEntry> = {}
  for (const s of servers) {
    if (!s.enabled) continue
    if (s.name === KANNA_MCP_SERVER_NAME) continue
    out[s.name] = toSdkEntry(s, oauthBearers)
  }
  return out
}
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| Skip name check in buildUserMcpServers because validateMcpShape already rejects it | Keep the filter at both sites | Defense-in-depth: storage validation can be bypassed by direct DB writes or migration gaps |
| Allow kanna name and rely on merge-order to win | Reject at each boundary | If user server wins the merge, mcp__kanna__* shims disappear from Claude's tool list |
| Only enforce at the API route level | Enforce at storage + the SDK build function | The build function receives a deserialized AppSettingsSnapshot; it must not trust that storage already validated |

## Scope

**Applies to:**

- `src/shared/settings/validation.ts` — `mcpServerNameIssue` reserved-name check, called by `validateMcpShape` in `src/server/app-settings.ts` at storage
- `src/server/claude-session-config.ts` — `buildUserMcpServers` SDK session filter

**Does NOT apply to:**

- The internal `kanna` server entry itself, which is always constructed by the SDK session build, never from user input

## Override

To deviate:

1. Document in an ADR `Compliance Rules` row with action `override` and a repo-specific reason
2. Cite rule-mcp-name-reserved
3. Name the exact call site and provide an alternative guard that prevents the `kanna` name from being injected into either driver's server map
