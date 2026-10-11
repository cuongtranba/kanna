---
target: c3-203
scope: insert
base: c3-203#n11153@v1:sha256:7e968e9592bddf6210208cce989e7eb994c31f10daa396f689a04e4e9b7d253c
---
| AuthBackend port | OUT | signIn, getSession, signOut over Better Auth; the only importer of better-auth and the auth database; changing --password rotates the owner credential and deletes every session | c3-203 | src/server/better-auth.adapter.ts |
