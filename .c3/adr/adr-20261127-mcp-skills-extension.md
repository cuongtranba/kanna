---
id: adr-20261127-mcp-skills-extension
c3-seal: 2f0058b15e6de690e89f28c509d72f504dbd8e58158d577f7efb1410af239c6d
title: mcp-skills-extension
type: adr
goal: Let Kanna host MCP-served Agent Skills (the `io.modelcontextprotocol/skills` extension, SEP-2640) in both directions. As a host, Kanna lists and loads skills that a user's custom MCP servers publish, offers them to the model and to the `/` picker next to local skills, and verifies every file against the server's manifest. As a server, the remote `/mcp` endpoint serves this machine's local skills to external MCP clients.
status: done
date: "2026-11-27"
---

## Goal

Let Kanna host MCP-served Agent Skills (the `io.modelcontextprotocol/skills` extension, SEP-2640) in both directions. As a host, Kanna lists and loads skills that a user's custom MCP servers publish, offers them to the model and to the `/` picker next to local skills, and verifies every file against the server's manifest. As a server, the remote `/mcp` endpoint serves this machine's local skills to external MCP clients.

## Context

Custom MCP servers only contributed tools. A server that publishes skills had no way to reach the model, and the remote `/mcp` endpoint exposed chats, projects and events but none of the skills already on this machine. The protocol is in the MCP SDK 2.x (`SkillsClient`, `SkillsExtension`, `SkillCatalog`, `nodeSkillFiles`), which the repo already depends on, so Kanna writes no protocol code. The provider CLIs (Claude, Codex, Antigravity) do not speak the extension, so they cannot discover MCP skills on their own. The hard constraints are the extension's host obligations: key skills by server and URI, put name, description, server and URI into model context, load only through a loader, verify size, sha256 digest and frontmatter against the manifest, restrict file reads to that manifest, never let a skill silently shadow a local one, and treat content as untrusted.

## Decision

Kanna opens its own MCP client connection per server for skills, a pooled SDK 2.x client wrapped in `SkillsClient` (`mcp-skill-client.adapter.ts`, stdio, http and sse; ws reports "skills need http, sse or stdio"), separate from the connection each provider CLI holds for tools. One module owns the state: `McpSkillHost` keeps a registry keyed by server id and skill URI, caches each server's listing for its `ttlMs` clamped to 60 s to 10 min (default 5 min), and refreshes at boot, on a `customMcpServers` change and lazily on expiry. Discovery never blocks a spawn: `roster` waits for an in-flight refresh at most 3 s and then returns the cache, so a slow server only costs a stale list. Nothing is persisted: no approval record and no on-disk cache, because the listing is cheap to refetch and every load is re-verified against the live manifest.

A skill's qualified name is `<server>:<name>`. When two skills on one server share a name, both use the skill path instead (`<server>:acme/billing/refunds`). When the qualified name equals a local command or skill name it becomes `mcp:<server>:<name>`. An MCP skill therefore never shadows a local one. The model loads a skill with `read_skill({server, uri})` and reads supporting files with `read_resource({server, uri})`, which is limited to the manifest of a skill already loaded (or the root of a loaded dynamic skill, with `.` and `..` segments, plain or percent-encoded, refused) and never crosses to another server. Text over 256 KiB is truncated, binary files report only type and size, and a skill over 512 files or 16 MiB is declined. Content is untrusted: the body arrives under an origin header naming the server and base URI, `allowed-tools` is ignored, and a dynamic skill is accepted but labelled unverified. A per-server Skills toggle (default on) removes a server's skills from the roster and the tools immediately.

On the server side, `buildRemoteMcpServer` attaches one `SkillCatalog` per runtime. `createRemoteMcpSkillFiles` presents a virtual tree, `personal/` (`~/.claude/skills`), `plugins/<plugin>/` (enabled Claude plugins) and `projects/<projectId>/` (each live project's `.claude/skills`), and delegates every real skill folder to the SDK's `nodeSkillFiles`, which refuses symlinks and `..`. The folders come from the new `LocalCatalogService.skillSources`, which reuses the existing scan and keeps shadowed skills with their scope and plugin. The catalog reloads at most every 30 s, lazily before a request is handled, and a changed listing calls the handler's `notify.resourcesChanged`.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-226 | component | Owns the MCP skill host, the pooled skills client port and the read\_skill and read\_resource tools | c3-226#n16229@v1:sha256:e91d518191f2658f0e6a7edae3aec9da4064c0e39f7ced6ace04189117b4ccaa | ref-strong-typing and rule-strong-typing: SDK types flow through with no casts; ref-side-effect-adapter: the only IO is the client adapter |
| c3-242 | component | The remote /mcp server attaches a skill catalog and serves local skills under skill:// | c3-242#n16232@v1:sha256:2ca52de53e644e1dcea42a2468f4d4f667065ee920f0c4638d4bed11a63acc6c | ref-side-effect-adapter: disk reads stay in remote-mcp-skill-files.adapter.ts and the SDK node adapter; ref-ws-subscription: skill file reads are a documented exception |
| c3-231 | component | LocalCatalogService.skillSources feeds the remote skill tree, and picker rows and /server:name expansion join the local ones | c3-231#n16235@v1:sha256:0e0b8e9b214021c148c2a42462fc9c485ab3149bc192a185a1e388084c5d200e | ref-local-first-data: nothing is cached on disk |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Hand each provider CLI the skills server through its own MCP tool channel | The CLIs list tools, not skills, so the model would see no roster, no picker row and no qualified name; the host could not verify files or refuse a mismatch |
| Persist an approval or a downloaded copy of each skill | A copy outlives the manifest it was verified against and invites silent drift; the live listing is cheap, and loading re-verifies every time |
| Block the spawn until every server has listed | One slow or dead server would stall every chat; the 3 s cap trades a stale roster for a spawn that always starts |
| Let an MCP skill win a name collision with a local skill | A remote server could shadow a trusted local skill; the mcp: prefix keeps local names authoritative |
| Re-implement the walk and the path checks for the remote tree | nodeSkillFiles already refuses symlinks and path escapes and the SDK enforces the file and byte limits; a second implementation is a second place to get traversal wrong |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A server serves a skill whose files differ from its manifest | SkillsClient.read checks size, sha256 and frontmatter and read\_skill returns a refusal, never the content | mcp-skill-host.test.ts: a SKILL.md and a supporting file that fail their digest are refused |
| A model reads a file outside a loaded skill, or escapes a dynamic skill root with dot segments | read\_resource accepts only manifest URIs of a loaded skill on the same server and rejects any URI with a dot segment | mcp-skill-host.test.ts: read before load, an unlisted file, another server and %2e%2E escapes are refused |
| Skill text is followed as if the user wrote it | The origin header and the roster state it is untrusted and allowed-tools is ignored | mcp-skill-host.test.ts: the loaded text carries the server name and the word untrusted |
| The remote tree exposes a file outside a skill folder | Real folders are served by nodeSkillFiles, segments are sanitised, and the catalog enforces 512 files and 16 MiB | remote-mcp-skills.test.ts reads through a real SkillsClient over HTTP |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/mcp-skills src/server/remote-mcp src/server/local-catalog.test.ts | all pass |
| bun run check, bun run check:arch | exit 0 |
| c3x check | exits 0 |
