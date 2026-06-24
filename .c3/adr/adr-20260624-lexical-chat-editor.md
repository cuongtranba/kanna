---
id: adr-20260624-lexical-chat-editor
c3-seal: 357824f66401a7ebfa049ca33c6a3cbb4ad3b8528fe4bf49c92e78357340fe27
title: lexical-chat-editor
type: adr
goal: Replace Kanna's chat composer (textarea-based `ChatInput.tsx`) and chat-message text rendering (`react-markdown`-based `TextMessage`/`UserMessage`) with a single Lexical-based editing/rendering model. The composer becomes a rich Lexical editor with structured nodes (mention chips, slash-command chips, inline attachment chips); message bodies render via `@lexical/headless` (parse markdown → Lexical state once per message → static React tree). This authorizes adding Lexical as the editing framework for `c3-115` (chat-ui-chrome) and the text-render slice of `c3-114` (messages-renderer), and retiring `react-markdown`/`remark-gfm` for chat text.
status: accepted
date: "2026-06-24"
---

## Goal

Replace Kanna's chat composer (textarea-based `ChatInput.tsx`) and chat-message text rendering (`react-markdown`-based `TextMessage`/`UserMessage`) with a single Lexical-based editing/rendering model. The composer becomes a rich Lexical editor with structured nodes (mention chips, slash-command chips, inline attachment chips); message bodies render via `@lexical/headless` (parse markdown → Lexical state once per message → static React tree). This authorizes adding Lexical as the editing framework for `c3-115` (chat-ui-chrome) and the text-render slice of `c3-114` (messages-renderer), and retiring `react-markdown`/`remark-gfm` for chat text.

## Context

Today the composer is a controlled `<textarea>`: mentions (`@agent/x`, `@path`) and slash commands (`/cmd`) are detected by regex over a `value: string` (`shouldShowMentionPicker`, `shouldShowPicker`), pickers float in an overlay positioned against `textarea.selectionStart`, and a `caretVersion` counter plus an iOS spacebar caret-jump workaround patch around controlled-textarea reconciliation. Attachments live in a strip below the input. Message text renders through `react-markdown` + `remark-gfm` with a large `defaultMarkdownComponents` override map (code→`HighlightedCode`, mermaid→`MermaidDiagram`, local-file links→`LocalFileLinkCard`, `<think>` via `parseThinkingSegments`). The pressure: the team needs richer composer use cases (structured mention/slash/attachment nodes, inline code regions) that string-regex parsing cannot model cleanly, and wants one node model shared by input and output. Constraint: the server `chat.send` wire contract (plain string with `@agent/<name>`, `/cmd`, paths + separate `attachments[]`) must NOT change. Affected topology is entirely client (`c3-1`): `c3-115` and `c3-114`.

## Decision

Adopt Lexical 0.45 (`lexical`, `@lexical/react`, `@lexical/markdown`, `@lexical/code`, `@lexical/list`, `@lexical/link`, `@lexical/utils`, `@lexical/headless`). Build custom nodes: `MentionNode`, `SlashCommandNode`, `AttachmentNode` (DecoratorNodes rendering existing chip/card React), plus `MermaidNode`, `LocalFileLinkNode`, `ThinkingNode` for message render. Composer plugins (typeahead mention/slash reusing existing data hooks, paste/drop image upload, submit-on-Enter, draft persistence) replace the overlay+regex machinery. A `serializeEditorToWireString` walks Lexical state to the exact legacy `chat.send` string so the server is untouched. Message text renders via `@lexical/headless`: a custom `TRANSFORMERS` array reaches GFM parity (tables, task lists, strikethrough, autolinks) plus mermaid/local-file/code-fence custom transformers; `CodeNode.decorate()` reuses the existing `HighlightedCode` component for zero visual regression. Headless render-once (not a live editor per bubble) keeps thousands of message bubbles performant. Chosen over a partial swap because the user requires all surfaces on one model; chosen over a live-editor-per-message because per-bubble editor instances do not scale.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-115 | component | Composer textarea + overlay pickers + attachment strip replaced by Lexical editor with mention/slash/attachment nodes and plugins | c3-115#n4997@v1:sha256:55ff85bd7e08123ceb990d355fef4d00d2c8d3638acd072d817d80d3383ef86f "Provide the composer and chat chrome" | Confirm Contract surfaces (Composer component, Send callback, Attachment controls) preserved; send still emits chat.send string |
| c3-114 | component | Text render slice (TextMessage/UserMessage) moves from react-markdown to Lexical headless render; mermaid/local-file/thinking become nodes | c3-114#n4947@v1:sha256:27c34f0051a7a59d7cab24990ec538a17e38cf2740694a17b24b0257ac9fc82f "Render each transcript entry kind" | Confirm per-kind dispatch + GFM parity; exhaustive entry-kind switch unchanged |
| c3-1 | container | Adds Lexical to client deps; new src/client/components/lexical/ module | c3-1#n4568@v1:sha256:e6ee951578f4d61705ac19fe636ff75594655216f900a12ae302ea0a1d8607a8 "Render the chat experience" | Verify no server/shared side-effect-seal breach; client-only |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-zustand-store | Composer draft + attachment drafts persist via useChatInputStore; draft type widens to carry SerializedEditorState | ref-zustand-store#n7499@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e "Client UI state lives in small Zustand stores" | comply |
| ref-provider-adapter | Message render stays provider-agnostic (Claude+Codex same path); render branches on hydrated kind only | ref-provider-adapter#n7329@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 "Normalize Claude Agent SDK and Codex App Server" | comply |
| ref-tool-hydration | TextMessage render swap must keep branching by entry kind, never by provider | ref-tool-hydration#n7433@v1:sha256:376e5fee261bd3b463633f19523020439854d9bd11ddc28ff5cffe12d8ed485e "are normalized into unified transcript entries" | comply |
| ref-strong-typing | Custom Lexical nodes use typed Serialized* shapes; no any/untyped maps in node state or serialize | ref-strong-typing#n7400@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af "No any / untyped shapes at boundaries" | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Composer-only Lexical, keep react-markdown for messages | User explicitly requires all surfaces on Lexical; leaves two render models and two bug surfaces |
| Live editable=false Lexical editor per message bubble | Per-bubble full editor instances do not scale to long transcripts; headless render-once is far cheaper |
| Keep textarea, add a rich-overlay layer | Does not deliver structured nodes (chips); perpetuates regex/caret fragility the change is meant to remove |
| @lexical/code-prism for message code blocks | Prism theme diverges from current HighlightedCode; reusing HighlightedCode in CodeNode.decorate gives zero visual regression |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Markdown parity gap vs remark-gfm (tables, task lists, footnotes) regresses message output | Custom TRANSFORMERS covering GFM; golden-file diff of legacy react-markdown vs Lexical-headless across representative corpus before deleting react-markdown | bun test src/client/components/lexical/markdown + golden-corpus diff |
| iOS spacebar caret-jump regression under Lexical contenteditable | Re-test on iOS Safari; Lexical selection model differs so legacy workaround may be unneeded or replaced | manual iOS smoke + composer cursor tests |
| Wire string drifts from legacy chat.send payload | serializeEditorToWireString unit tests asserting byte-equivalent output for mention/slash/path/text/code | bun test src/client/components/lexical/serialize |
| Streamed assistant text re-render cost | Headless render memoized by content hash; benchmark streaming | manual streaming smoke + transcript perf check |
| Per-message Lexical editor leak | Headless render produces static tree, no mounted editor per bubble | code review + memory smoke |

## Verification

| Check | Result |
| --- | --- |
| bun test (full suite) | all pass |
| bun run lint (--max-warnings=0) | zero errors, warning cap not exceeded |
| bun test src/client/components/lexical/ | all new node/plugin/serialize/transformer suites pass |
| Golden-corpus diff: react-markdown vs Lexical-headless render | no semantic diff across corpus |
| Browser smoke: send message with @mention, /command, pasted image, code block; verify chat.send payload + rendered bubble | composer + render parity confirmed |
| serializeEditorToWireString round-trip tests | every node kind emits legacy-equivalent text |
