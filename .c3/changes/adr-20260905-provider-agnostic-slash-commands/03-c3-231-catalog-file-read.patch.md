---
target: c3-231
scope: insert
base: c3-231#n11830@v1:sha256:a61df6d7e35934b1434ed3e8f2d5329de720179304c23ca0195996f251fcac6e
---
| readCatalogFileBody | OUT | Pure IO; full text of one catalog file, or null when missing, unreadable, or past CATALOG_FILE_MAX_BYTES (256 KiB). The scan reads only the frontmatter prefix; an expansion needs the body, and the body goes straight into a turn's context. Null rather than throw — it runs on the send path, where the fallback is to send the line as typed | c3-210 | src/server/local-catalog-io.adapter.ts |
