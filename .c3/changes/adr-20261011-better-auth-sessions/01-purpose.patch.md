---
target: c3-203
scope: block
base: c3-203#n11128@v1:sha256:50bcadbd0f38e26ac3dc16e3f770a964df4524c38c2486c0a297243325223581
---
Issues and validates a launch-password session cookie, blocks unauthenticated HTTP/WS/API requests, and surfaces a login form when `--password` is set. Better Auth owns credential hashing, session storage, cookie signing and sign-in rate limiting behind a hidden owner user whose credential is the CLI password; Kanna owns the `/auth/*` routes, the origin check and the per-request Secure attribute. Non-goals: per-user accounts, OAuth, multi-tenant auth — single launch password only.
