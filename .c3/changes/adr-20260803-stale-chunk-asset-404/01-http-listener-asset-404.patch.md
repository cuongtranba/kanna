---
target: c3-202
scope: block
base: c3-202#n6773@v1:sha256:318adcf13909f5ff193a968c20a1f853df50ae1f3d5aca4443ab353397d8eae5
---
| HTTP listener | IN | Serves static assets + API + upgrade; a request whose last path segment carries a non-`.html` extension is an asset request and 404s when the file is absent — only extensionless navigation paths fall back to index.html | c3-101 | src/server/server.ts |
