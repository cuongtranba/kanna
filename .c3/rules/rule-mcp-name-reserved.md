---
id: rule-mcp-name-reserved
c3-seal: b2f0e61c6e33a09512d44846f04e15ae5339e248f3cf6528192e986c971ca015
title: mcp-name-reserved
type: rule
goal: |-
    User MCP server names registered in `customMcpServers` must never equal
    `KANNA_MCP_SERVER_NAME` ("kanna"). Enforced at storage, SDK driver, and PTY
    driver so the Kanna-internal MCP tool surface is never shadowed or overwritten
    by a user-supplied server.
---

# mcp-name-reserved

## Goal

User MCP server names registered in `customMcpServers` must never equal
`KANNA_MCP_SERVER_NAME` ("kanna"). Enforced at storage, SDK driver, and PTY
driver so the Kanna-internal MCP tool surface is never shadowed or overwritten
by a user-supplied server.

## Rule

User MCP server names registered in `customMcpServers` must never equal
`KANNA_MCP_SERVER_NAME` ("kanna"). Enforced at storage (`validateMcpShape`),
SDK driver (`buildUserMcpServers`), and PTY driver (`buildMcpConfigJson`
filter).

## Golden Example

```ts
// src/shared/app-settings.ts
const KANNA_MCP_SERVER_NAME = "kanna"

export function validateMcpShape(entry: unknown): McpServerConfig {
  const parsed = McpServerConfigSchema.parse(entry)
  if (parsed.name === KANNA_MCP_SERVER_NAME) {
    throw new Error(`MCP server name "${KANNA_MCP_SERVER_NAME}" is reserved`)
  }
  return parsed
}
```

```ts
// src/server/agent.ts
export function buildUserMcpServers(servers: McpServerConfig[]): McpServersMap {
  return Object.fromEntries(
    servers
      .filter((s) => s.enabled && s.name !== KANNA_MCP_SERVER_NAME) // belt-and-suspenders
      .map((s) => [s.name, toSdkTransportConfig(s)]),
  )
}
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| Skip name check in buildUserMcpServers because validateMcpShape already rejects it | Keep the filter in all three sites | Defense-in-depth: storage validation can be bypassed by direct DB writes or migration gaps |
| Allow kanna name and rely on merge-order to win | Reject at each boundary | If user server wins the merge, mcp__kanna__* shims disappear from Claude's tool list |
| Only enforce at the API route level | Enforce at storage + both driver build functions | Driver functions receive deserialized AppSettingsSnapshot; they must not trust that storage already validated |

## Scope

**Applies to:**

- `src/shared/app-settings.ts` — `validateMcpShape` storage guard
- `src/server/agent.ts` — `buildUserMcpServers` SDK driver filter
- `src/server/kanna-mcp-http.ts` — `buildMcpConfigJson` PTY driver filter

**Does NOT apply to:**

- The internal `kanna` server entry itself, which is always constructed by `buildMcpConfigJson` / the SDK driver, never from user input

## Override

To deviate:

1. Document in an ADR `Compliance Rules` row with action `override` and a repo-specific reason
2. Cite rule-mcp-name-reserved
3. Name the exact call site and provide an alternative guard that prevents the `kanna` name from being injected into either driver's server map
