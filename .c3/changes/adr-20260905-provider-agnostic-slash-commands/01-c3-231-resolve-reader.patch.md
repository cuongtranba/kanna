---
target: c3-231
scope: insert
base: c3-231#n11830@v1:sha256:a61df6d7e35934b1434ed3e8f2d5329de720179304c23ca0195996f251fcac6e
---
| LocalCatalogService.resolve | OUT | (cwd, name) → the winning RawCatalogEntry incl. the filePath list drops, case-insensitive; restricted to user-invocable entries so a typed /name and the picker cannot disagree about which names exist. Reads the cached row — no rescan | c3-210 | src/server/local-catalog.ts |
