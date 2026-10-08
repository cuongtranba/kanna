---
id: rule-mcp-name-reserved
c3-seal: 9f87b8e5f2c1b172773bc02d1615696426dcfcfd8c23513d87d94632ebbbd8d5
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
| Skip name check in buildUserMcpServers because validateMcpShape already rejects it | Keep the filter at both sites | Defense-in-depth: storage validation can be bypassed by direct DB writes or migration gaps |
| Allow kanna name and rely on merge-order to win | Reject at each boundary | If user server wins the merge, mcp__kanna__* shims disappear from Claude's tool list |
| Only enforce at the API route level | Enforce at storage + the SDK build function | The build function receives a deserialized AppSettingsSnapshot; it must not trust that storage already validated |

## Scope

**Applies to:**

- `src/shared/app-settings.ts` — `validateMcpShape` storage guard
- `src/server/agent.ts` — `buildUserMcpServers` SDK session filter

**Does NOT apply to:**

- The internal `kanna` server entry itself, which is always constructed by the SDK session build, never from user input

## Override

To deviate:

1. Document in an ADR `Compliance Rules` row with action `override` and a repo-specific reason
2. Cite rule-mcp-name-reserved
3. Name the exact call site and provide an alternative guard that prevents the `kanna` name from being injected into either driver's server map
