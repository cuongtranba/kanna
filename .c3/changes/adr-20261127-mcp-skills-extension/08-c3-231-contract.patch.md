---
target: c3-231
scope: insert
base: c3-231#n14150@v1:sha256:d3842f5d885fba073b04e58ea719c90109e0528e485a2d744c5a55e071c48621
---
| LocalCatalogService.skillSources | OUT | cwd to LocalSkillSource[] (name, scope, pluginName, filePath) for every skill the scan found, including a skill a stronger scope shadows, sorted by path, from the same cached scan as list; homeDir is public so a caller can scan the personal and plugin scopes with the home folder as cwd. The remote /mcp skill tree is the consumer | c3-242 | src/server/local-catalog.ts, src/server/local-catalog.test.ts |
| MCP skill picker rows | OUT | localCommandsForCwd appends host entries as SlashCommand rows with scope mcp, kind skill and the server name, computed against the local names so an MCP skill never takes one; buildMcpSkillInvocation in slash-expansion.ts writes the prompt that calls read\_skill | c3-226 | src/server/claude-slash-commands.ts, src/shared/slash-expansion.ts |
