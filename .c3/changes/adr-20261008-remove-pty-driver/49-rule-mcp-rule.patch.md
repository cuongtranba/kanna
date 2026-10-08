---
target: rule-mcp-name-reserved
scope: block
base: rule-mcp-name-reserved#n13934@v1:sha256:43f075905d532466b3b381df83682cb06b7a18c7e5df1ef5b0ec403f8bf458db
---
User MCP server names registered in `customMcpServers` must never equal
`KANNA_MCP_SERVER_NAME` ("kanna"). Enforced at storage (`validateMcpShape`)
and in the SDK session build (`buildUserMcpServers` filter).
