---
target: c3-242
scope: insert
base: c3-242#n13633@v1:sha256:8442b1609973b02dfa862a47ed26baba47e02628b9ef9f7eb75e0df8b3fd6fa5
---
| Command origin | OUT | The registrar builds a RemoteMcpOrigin per tool call (client id, optional client name from the per-request envelope, via oauth or password, tool, call id) and runs the handler in an AsyncLocalStorage scope; the runtime's dispatchCommand reads the scope and passes the origin to the router, so no tool threads it by hand; the origin reaches the queue, the user_prompt transcript entry and the board actor and is withheld from share snapshots | c3-208 | src/server/remote-mcp/remote-mcp-tool-registrar.ts, src/server/remote-mcp/remote-mcp-call-scope.ts, src/shared/command-origin.ts |
