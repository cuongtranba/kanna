---
target: rule-mcp-name-reserved
scope: block
base: rule-mcp-name-reserved#n13932@v1:sha256:14b198db67176b15a6f8ec8867c7a09d1960aec6a98bb33e1fc658ec05e52de3
---
User MCP server names registered in `customMcpServers` must never equal
`KANNA_MCP_SERVER_NAME` ("kanna"). Enforced at storage and in the SDK session
build so the Kanna-internal MCP tool surface is never shadowed or overwritten
by a user-supplied server.
