---
id: adr-20260624-lexical-chat-editor
c3-seal: 3f8556183b603d2580818ac6124a620f88aaa044e2e6e727a15919d3bfaf850a
title: lexical-chat-editor
type: adr
goal: Replace Kanna's chat composer (textarea-based `ChatInput.tsx`) and chat-message text rendering (`react-markdown`-based `TextMessage`/`UserMessage`) with a single Lexical-based editing/rendering model. The composer becomes a rich Lexical editor with structured nodes (mention chips, slash-command chips, inline attachment chips); message bodies render via `@lexical/headless` (parse markdown → Lexical state once per message → static React tree). This authorizes adding Lexical as the editing framework for `c3-115` (chat-ui-chrome) and the text-render slice of `c3-114` (messages-renderer), and retiring `react-markdown`/`remark-gfm` for chat text.
status: implemented
date: "2026-06-24"
---

## Goal

Replace Kanna's chat composer (textarea-based `ChatInput.tsx`) and chat-message text rendering (`react-markdown`-based `TextMessage`/`UserMessage`) with a single Lexical-based editing/rendering model. The composer becomes a rich Lexical editor with structured nodes (mention chips, slash-command chips, inline attachment chips); message bodies render via `@lexical/headless` (parse markdown → Lexical state once per message → static React tree). This authorizes adding Lexical as the editing framework for `c3-115` (chat-ui-chrome) and the text-render slice of `c3-114` (messages-renderer), and retiring `react-markdown`/`remark-gfm` for chat text.

## Context

Today the composer is a controlled `<textarea>`: mentions (`@agent/x`, `@path`) and slash commands (`/cmd`) are detected by regex over a `value: string`, pickers float in an overlay positioned against `textarea.selectionStart`, and a `caretVersion` counter plus an iOS spacebar caret-jump workaround patch around controlled-textarea reconciliation. Attachments live in a strip below the input. Message text renders through `react-markdown` + `remark-gfm` with a large `defaultMarkdownComponents` override map. The pressure: the team needs richer composer use cases (structured mention/slash/attachment nodes, inline code regions) that string-regex parsing cannot model cleanly, and wants one node model shared by input and output. Constraint: the server `chat.send` wire contract (plain string with `@agent/<name>`, `/cmd`, paths + separate `attachments[]`) must NOT change. Affected topology is entirely client (`c3-1`): `c3-115`, `c3-114`, and `c3-102` (chatInputStore draft type widened).

## Decision

Adopt Lexical 0.45 (`lexical`, `@lexical/react`, `@lexical/markdown`, `@lexical/code`, `@lexical/list`, `@lexical/link`, `@lexical/utils`, `@lexical/headless`). Build custom nodes: `MentionNode`, `SlashCommandNode`, `AttachmentNode` (DecoratorNodes rendering existing chip/card React), plus `MermaidNode`, `LocalFileLinkNode`, `ThinkingNode` for message render. Composer plugins (typeahead mention/slash reusing existing data hooks, paste/drop image upload, submit-on-Enter, draft persistence) replace the overlay+regex machinery. A `serializeEditorToWireString` walks Lexical state to the exact legacy `chat.send` string so the server is untouched. Message text renders via `@lexical/headless`: a custom `TRANSFORMERS` array reaches GFM parity plus mermaid/local-file/code-fence custom transformers. Headless render-once keeps thousands of message bubbles performant.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-115 | component | Composer textarea + overlay pickers replaced by Lexical editor with mention/slash/attachment nodes and plugins | src/client/components/chat-ui/ChatInput.tsx | Confirm Contract surfaces (Composer component, Send callback, Attachment controls) preserved; send still emits chat.send string |
| c3-114 | component | Text render slice moves from react-markdown to Lexical headless render; shared.tsx react-markdown exports removed | src/client/components/messages/shared.tsx | Confirm per-kind dispatch + GFM parity; exhaustive entry-kind switch unchanged |
| c3-102 | component | chatInputStore.ts draft type widens: DraftEntry {text, lexicalState?} added; setDraft API widened to 3 args; getDraft return type narrowed to DraftEntry | null | src/client/stores/chatInputStore.ts |
| c3-1 | container | Adds Lexical to client deps; new src/client/components/lexical/ module | src/client/components/lexical/ | Verify no server/shared side-effect-seal breach; client-only |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-zustand-store | Composer draft + attachment drafts persist via useChatInputStore; draft type widens to carry SerializedEditorState | src/client/stores/chatInputStore.ts DraftEntry type | comply |
| ref-colocated-bun-test | chatInputStore.ts is modified; colocated chatInputStore.test.ts must cover new DraftEntry/setDraft paths | src/client/stores/chatInputStore.test.ts | comply |
| ref-provider-adapter | Message render stays provider-agnostic; render branches on hydrated kind only | src/client/components/messages/TextMessage.tsx | comply |
| ref-tool-hydration | TextMessage render swap must keep branching by entry kind, never by provider | src/client/components/messages/ dispatch map | comply |
| ref-strong-typing | Custom Lexical nodes use typed Serialized* shapes; no any/untyped maps in node state or serialize | src/client/components/lexical/nodes/ | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-zustand-store | chatInputStore.ts is a Zustand store; setDraft API widened to carry SerializedEditorState must stay in the store | comply |
| rule-strong-typing | Custom Lexical node serialize/deserialize functions and DraftEntry must use typed shapes, no any | comply |
| rule-colocated-bun-test | New Lexical modules and modified chatInputStore must have colocated .test.ts(x) files | comply |
| rule-mcp-name-reserved | N.A — client-only change; no MCP server names affected | N.A - client-only |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| ChatInput.tsx | Replace textarea + overlay with LexicalComposer + ContentEditable + plugins; add processUploadQueueRef + startTransition patterns for lint compliance | src/client/components/chat-ui/ChatInput.tsx |
| chatInputStore.ts | Add DraftEntry { text, lexicalState? } type; widen setDraft to (chatId, SerializedEditorState | string, text?) and getDraft to return DraftEntry |
| shared.tsx | Remove react-markdown exports; keep MetaRow, MetaContent, MetaLabel, MermaidFallbackCodeBlock etc. | src/client/components/messages/shared.tsx |
| package.json | Remove react-markdown@^10.1.0 and remark-gfm@^4.0.1 from dependencies | package.json |
| lexical/markdown/lexicalToReact | New headless render module: @lexical/headless parse + React tree output | src/client/components/lexical/markdown/lexicalToReact.ts |
| MarkdownBody.tsx | Fix import path depth for lexicalToReact | src/client/components/messages/file-preview/bodies/MarkdownBody.tsx |
| C3 doc: c3-115 | Update Purpose section to reference Lexical rich-text editor instead of textarea | c3-115 Purpose section |
| ADR | Transition status accepted → implemented after Wave 3 gate passes | adr-20260624-lexical-chat-editor |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-115 component | Purpose section rewritten to reference Lexical rich-text editor | c3x read c3-115 --section Purpose |
| ADR status | Transition from accepted to implemented after all Verification checks pass | c3x read adr-20260624-lexical-chat-editor field status = implemented |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test --conditions production | Lexical ESM dev-mode TDZ requires production conditions; all 2790 tests pass | package.json test script |
| bun run lint --max-warnings=0 | ESLint react-hooks plugin enforces preserve-manual-memoization, set-state-in-effect, refs rules | eslint.config.js max-warnings cap |
| bunx tsc --noEmit | TypeScript strict mode; DraftEntry types, Lexical node shapes, RefObject types all checked | tsconfig.json |
| serializeEditorToWireString unit tests | Round-trip tests assert byte-equivalent chat.send payload for all node kinds | src/client/components/lexical/serialize.test.ts |
| bun test src/client/components/chat-ui/ChatInput.test.ts | SSR smoke: confirms contentEditable, aria-label, aria-placeholder, send/stop button labels | src/client/components/chat-ui/ChatInput.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Composer-only Lexical, keep react-markdown for messages | User explicitly requires all surfaces on Lexical; leaves two render models and two bug surfaces |
| Live editable=false Lexical editor per message bubble | Per-bubble full editor instances do not scale to long transcripts; headless render-once is far cheaper |
| Keep textarea, add a rich-overlay layer | Does not deliver structured nodes (chips); perpetuates regex/caret fragility the change is meant to remove |
| @lexical/code-prism for message code blocks | Prism theme diverges from current HighlightedCode; reusing HighlightedCode gives zero visual regression |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Markdown parity gap vs remark-gfm regresses message output | Custom TRANSFORMERS covering GFM; react-markdown removed only after Lexical headless passes test suite | bun test src/client/components/lexical/markdown |
| iOS spacebar caret-jump regression under Lexical contenteditable | Re-test on iOS Safari; Lexical selection model differs so legacy workaround may be unneeded or replaced | manual iOS smoke |
| Wire string drifts from legacy chat.send payload | serializeEditorToWireString unit tests assert byte-equivalent output for all node kinds | bun test src/client/components/lexical/serialize |
| Streamed assistant text re-render cost | Headless render memoized by content hash | manual streaming smoke |
| Per-message Lexical editor leak | Headless render produces static tree, no mounted editor per bubble | code review + memory smoke |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production (full suite) | 2790 pass, 0 fail — Wave 1–3 combined |
| bun run lint --max-warnings=0 | 0 errors, 0 warnings — cap met |
| bun test src/client/components/lexical/ | all Lexical node/plugin/serialize/transformer suites pass |
| react-markdown + remark-gfm removed from package.json | confirmed removed |
| shared.tsx react-markdown exports removed | markdownComponents, createMarkdownComponents, defaultRemarkPlugins, LocalLink, extractTextFromNode all removed |
| ChatInput.tsx Lexical contenteditable | aria-label, aria-placeholder, role=textbox present in SSR smoke |
| processUploadQueueRef + startTransition patterns | preserve-manual-memoization and set-state-in-effect warnings resolved |
| bunx tsc --noEmit | 0 errors |
