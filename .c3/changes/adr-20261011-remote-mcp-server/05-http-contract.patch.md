---
target: c3-202
scope: insert
base: c3-202#n11137@v1:sha256:dd5b274bf77e5ac772e1290ec609f9637a3e70bf4398892b993eca4a575b4baf
---
| /mcp | IN | Remote MCP Streamable HTTP endpoint, dispatched BEFORE the cookie gate because it authenticates with a bearer; answers 404 without --password or when remoteMcp.enabled is off | c3-242 | src/server/http-dispatcher.ts |
| /oauth/login and /oauth/consent | IN | Server-rendered OAuth sign-in and consent pages, dispatched before the cookie gate | c3-242 | src/server/http-dispatcher.ts |
| OAuth and well-known paths | IN | The allowlisted /api/auth/oauth2/authorize, token, register, revoke, /api/auth/jwks and the well-known protected-resource, authorization-server and openid-configuration documents, dispatched before the /api/ cookie gate so the OAuth endpoints are never behind a session | c3-242 | src/server/remote-mcp/remote-mcp-http-routes.ts |
