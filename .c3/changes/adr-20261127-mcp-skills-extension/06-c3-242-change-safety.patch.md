---
target: c3-242
scope: insert
base: c3-242#n14759@v1:sha256:69273f43ac91555055ab4ebe9890c3cc3cf334fb0f53738c9d923642ecf9f9ad
---
| Skill tree escapes its folder | createRemoteMcpSkillFiles stops delegating to nodeSkillFiles, or a segment is built from unsanitised input, so a symlink or a dot-dot path reaches a file outside a skill folder | remote-mcp-skills.test.ts reads skills through a real SkillsClient over HTTP; remote-mcp-skills-reload.test.ts covers the 30 s reload | bun run test src/server/remote-mcp/ |
