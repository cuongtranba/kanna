---
target: c3-203
scope: block
base: c3-203#n11159@v1:sha256:688e30f3d4051de77c76e85694a0602bc7136d1ae6846a9a4d579a08c79a570a
---
Issues and validates a launch-password session cookie, blocks unauthenticated HTTP/WS/API requests, and surfaces a login form when `--password` is set. Better Auth owns credential hashing, session storage, cookie signing and sign-in rate limiting behind a hidden owner user whose credential is the CLI password; Kanna owns the `/auth/*` routes, the origin check and the per-request Secure attribute. The same Better Auth instance is also the OAuth 2.1 authorization server for the remote MCP endpoint (c3-242): the `mcp()` and `jwt()` plugins issue the tokens, an allowlist (`handleOAuth`) is the only way requests reach it, and the launch password is accepted as a bearer through one cached sign-in so the hash check and the limiter stay the only verifier. Non-goals: per-user accounts, multi-tenant auth — single launch password only.
