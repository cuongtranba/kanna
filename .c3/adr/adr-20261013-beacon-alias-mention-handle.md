---
id: adr-20261013-beacon-alias-mention-handle
c3-seal: 6f830eadf9c17e585a044c4db89aa795cecfddf4554456a2ecca8f189510e818
title: beacon-alias-mention-handle
type: adr
goal: Record how a paired beacon gets a short, typeable name and how a chat message names a beacon. A beacon gains an optional alias that is a slug handle kept separate from its hostname label, the display name becomes the alias when one is set, a message can name a beacon with an at-beacon mention that resolves through one shared index, and the resolved beacon id reaches only the provider prompt, never the stored user prompt.
status: done
date: "2026-10-13"
---

## Goal

Record how a paired beacon gets a short, typeable name and how a chat message names a beacon. A beacon gains an optional alias that is a slug handle kept separate from its hostname label, the display name becomes the alias when one is set, a message can name a beacon with an at-beacon mention that resolves through one shared index, and the resolved beacon id reaches only the provider prompt, never the stored user prompt.

## Context

A beacon was known only by the hostname its machine reported at pairing, which is long, not unique across reinstalls and awkward to type. The agent learned a beacon id only by calling beacon_list, and every beacon tool needs that id. Separately, the settings list merged live status rows with stored configs by adding configs missing from the rows but never dropping a row whose config had been deleted, so a revoked beacon stayed on screen. The mention syntax must resolve identically in the composer and on the server, and the server must not alter what the user typed because the transcript, the title generator and queued-message replay read that text.

## Decision

The alias is optional on the stored config, validated as a lowercase slug that is unique among beacons, and stays separate from the hostname label, which remains the pairing identity and is shown as secondary text. The display name is the alias when set and the label otherwise, defined once in src/shared/beacon-alias.ts. The same module builds the mention index: aliases claim their handle first, a beacon without an alias gets a slug of its hostname, and a taken handle gets a numeric suffix in beacon id order, so client and server always agree. The server resolves mentions in the turn starter and appends a short block naming each mentioned beacon id, hostname, OS, online state and enabled state to the provider prompt only, and only for providers that receive Kanna tools; Codex receives the text unchanged. Stored user prompt content is untouched. The beacons list is now owned by stored configs: they decide which rows exist and supply label, alias, OS and enabled, while live rows supply only online state, last seen, version and update status. Removing a beacon re-pushes the beacons topic to every open client, closes that beacon's live socket and forgets it in the registry, so a reconnect is refused as an unknown beacon.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-302 | component | Owns the shared beacon contracts that gain the alias field, the status row alias and the mention index module | c3-302#n13569@v1:sha256:4c7ecffd69e947220d2e183aff508ff27068adad53b1b11d4434236e59af2b8b | The new module is pure and typed with no unknown or cast, and its rules are covered by a colocated test |
| c3-116 | component | The Beacons settings section gains the alias editor, the per-setting explanations and the config-owned row list | c3-116#n10811@v1:sha256:96184f28a16b15d205286ed2fbf21a17c8e00f707bac796faaeb2170221cfc73 | Every new control renders pending state through the pending action store and keeps selectors reference-stable |
| c3-210 | component | The turn starter appends the beacon block to the provider prompt without changing the stored prompt | c3-210#n11742@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | The stored user prompt keeps exactly what the user typed, covered by a turn starter test |
| c3-202 | component | The broadcast manager re-pushes the beacons topic on a settings change and the beacon services revoke a removed beacon, closing its socket | c3-202#n11318@v1:sha256:2e868029505a294cb79ac3750f443e489fdca9fb37d30d865fbfc0e47ac582e0 | Revocation now also severs the live connection; a ws-router test and a beacon-services test pin both |
| c3-110 | component | The composer suggestion hook and chip resolver for beacon mentions sit beside the project and agent equivalents | c3-110#n10487@v1:sha256:8d467214a2dbc5cf341cd31b54660de18b2f9baef295c94a728736a1b1c49b29 | The hook returns a stable empty array when disabled |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Rename the label field instead of adding an alias | The label is checked for uniqueness at pairing and is what a reinstall reports, so overwriting it would lose the hostname the user needs to recognise the machine |
| Resolve a beacon by its label in the mention | Hostnames contain spaces, dots and capitals that the mention token cannot carry, and two machines can share one |
| Inject the beacon block into the stored user prompt | The transcript, title generation and queued-message replay read that text, so the user would see and replay text they never typed |
| Keep merging live rows and configs by adding missing configs | A deleted config never removes its row, which is the reported bug |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/shared/beacon-alias.test.ts src/server/beacon-mention-prompt.test.ts src/server/beacon-settings.test.ts src/server/beacon-services.test.ts | Passes |
| bun run test src/client/app/BeaconsSection.test.tsx src/server/ws-router.test.ts | Passes |
| bash ~/.agents/skills/c3/bin/c3x.sh check | Exits ok with no new issues |
