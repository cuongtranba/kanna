---
id: c3-124
c3-seal: 75fb61098d1af67d018fd72868e34cb0336077c90246baf5ec6ef6dff39b5448
title: remote-mcp-ui
type: component
category: feature
parent: c3-1
goal: Show the Remote MCP settings page where the owner turns the server on or off, sets its public URL and copies per-client setup snippets.
uses:
    - ref-zustand-store
    - rule-colocated-bun-test
    - rule-strong-typing
    - rule-zustand-store
---

## Goal

Show the Remote MCP settings page where the owner turns the server on or off, sets its public URL and copies per-client setup snippets.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Settings surfaces" — one more page in the settings sidebar beside MCP servers and Plugins |
| Category | feature |
| Lifecycle | Rendered while the Remote MCP settings route is open; the draft and copied-state live in a Zustand store |
| Replaceability | Replaceable while the remoteMcp settings patch and the snippet builder contract are preserved |

## Purpose

Renders the Remote MCP page registered in the settings sidebar: a notice when Kanna runs without a password, an enable switch bound to remoteMcp.enabled, a public URL field saved as remoteMcp.publicUrl, the derived endpoint, and one card per client with a Copy button. The snippets come from a pure shared builder that never embeds the password. Non-goals: serving the endpoint (c3-242), validating tokens, and any persistence beyond the settings patch.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | The settings page is open and has fetched /auth/status into the settings page store | c3-116 |
| Input — settings | The app settings store supplies remoteMcp through a stable selector | c3-116 |
| Output — writes | state.handleWriteAppSettings sends settings.writeAppSettingsPatch through runPendingAction | c3-101 |
| Shared dep — normalizer | normalizeRemoteMcpPublicUrl keeps the Save button honest before the server normalizes | c3-242 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | The owner can connect an external agent by copying one snippet | c3-242 |
| Primary path | Open Settings, Remote MCP, set a public URL, copy the snippet for the client | c3-116 |
| Alternate — no password | A muted notice says to start Kanna with --password and the snippets say so too | c3-203 |
| Failure — save rejected | The command error is shown under the field and the draft is kept | c3-116 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-zustand-store | ref | Draft, copied state and error live in a store, never component state | must follow | useState is banned in the client |
| rule-zustand-store | rule | State transitions are store actions | wired compliance target | the section only calls setters |
| rule-strong-typing | rule | Props and snippets are named types | wired compliance target | no casts in the section |
| rule-colocated-bun-test | rule | The section and the builder each have a colocated test | wired compliance target | markup and loop checks |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| RemoteMcpSection | OUT | Registered as the remote-mcp service branch of the settings page; takes handleWriteAppSettings and an optional DomPort | c3-116 | src/client/components/settings/RemoteMcpSection.tsx |
| buildRemoteMcpSetupSnippets | OUT | Returns one snippet per client with the endpoint filled in and the placeholder text where the password goes | c3-242 | src/shared/remote-mcp/setup-snippets.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Password embedded in a snippet | A snippet builder interpolates a real credential | The snippets test asserts the placeholder is the only credential text | bun run test src/shared/remote-mcp/setup-snippets.test.ts |
| Render loop from an unstable selector | The section reads a fresh object from the store each render | The loop-check mount reports no update-depth warning | bun run test src/client/components/settings/RemoteMcpSection.test.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/stores/remoteMcpSectionStore.ts | Contract (RemoteMcpSection settings branch) | Field names | src/client/stores/remoteMcpSectionStore.ts |
