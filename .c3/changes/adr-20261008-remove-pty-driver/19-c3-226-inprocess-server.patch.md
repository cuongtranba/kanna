---
target: c3-226
scope: block
base: c3-226#n12103@v1:sha256:18a36d7ec46c315bc0e8ce32651d2e4911d9fcb10126057f70c28b98604e88e8
---
| In-process MCP server | IN | createKannaMcpServer builds an SDK MCP server that startClaudeSession passes in options.mcpServers beside the user's custom servers; there is no HTTP endpoint and no port | c3-210 | src/server/kanna-mcp.ts |
