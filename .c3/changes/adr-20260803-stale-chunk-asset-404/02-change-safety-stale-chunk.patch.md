---
target: c3-202
scope: block
base: c3-202#n6782@v1:sha256:cfd9aea182fa0c49da3fe9fe12cbefcb9a4ffb6650ae04333d9b319bfeedf7f0
---
| Static asset 404 | Build path drift, or a tab left open across a deploy requesting a deleted hashed chunk | Asset request answers 200 text/html instead of 404, so the browser reports "Failed to fetch dynamically imported module" | bun test --conditions production src/server/static-serve.test.ts |
