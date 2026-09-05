---
target: c3-231
scope: insert
base: c3-231#n11830@v1:sha256:a61df6d7e35934b1434ed3e8f2d5329de720179304c23ca0195996f251fcac6e
---
| LocalCatalogService.skills | OUT | cwd → SkillRosterEntry[] (name, description, absolute SKILL.md path) for the roster a provider with no skill machinery is told at session start. Skills only — a command template is user-invoked, not model-invoked — and deliberately INCLUDING user-invocable: false entries, which are hidden from the picker but still auto-triggerable | c3-210 | src/server/local-catalog.ts |
