---
target: c3-226
scope: insert
base: c3-226#n13818@v1:sha256:fe6bf4708817185e3805a9785fa64991dac46fc0cad040f17d8f6f5e3e0cd1a3
---
| MCP skill content trusted or unverified | An edit lets read\_resource read a URI outside a loaded skill's manifest, skips SkillsClient.read verification, lets a dot or dot-dot segment pass the root check, or lets an MCP skill take a local name | mcp-skill-host.test.ts asserts a tampered SKILL.md and supporting file are refused, a read before load, another server and %2e%2E escapes fail, and a colliding name is prefixed mcp: | bun run test src/server/mcp-skills/ |
