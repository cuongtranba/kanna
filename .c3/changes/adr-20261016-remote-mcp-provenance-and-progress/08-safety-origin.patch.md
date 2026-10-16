---
target: c3-242
scope: insert
base: c3-242#n13644@v1:sha256:33024f72476a60363416b4f513fa06aa3a9a24373921911341a8806805786859
---
| Origin trusted from the caller | stampCommandOrigin stops replacing a caller-supplied origin, or a browser socket gets a commandOrigin | A browser or a forged kanna_command parameter labels its own message as coming from MCP | bun run test src/server/ws-router.test.ts src/server/remote-mcp/remote-mcp-tools.test.ts |
