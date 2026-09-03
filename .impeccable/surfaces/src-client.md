---
version: 1
slug: "src-client"
primary_target: "src/client"
related_targets: []
---

Scope: the whole Kanna client (chat surface, boards, settings). Visitor mode: Operate.

Audience: solo developers watching two or three agents across projects for hours, at a desk, on a real monitor. Task: tell at a glance what each session is doing, steer any of them, trust the transcript. Constraint: density in the transcript is not negotiable; the gates in CLAUDE.md (design gate, tone-pairings contrast test, ast-grep, arch budget, 350kB bundle) all bind.

## Direction contract

THESIS: Kanna is an independent art publication about your agent sessions. Every session has a faithful plate and a small reduction. It refuses the card-grid dashboard: nine card shells currently spend the space that should be white.

OWN-WORLD: Four inks (Paper, Ink, Margin, Coral); every other value a mix of two. No boxes, no radius, no shadow on content. Plates are space plus one hairline plus a caption. State is mark-form (doubled, based, struck, half) rather than hue. Verbatim material is the single exception and keeps diff colour.

STORY: The developer reads the index, sees which session is live from mark shape alone, opens it, and reads the transcript as a printed monograph.

FIRST VIEWPORT: Running head with wordmark and live fact line. Left index of sessions, each with its reduction sigil. Centre column of plates on one off-centre rail. Right colophon with context, background tasks, worktree, spend. Composer sits on the rail at the foot.

FORM: Plate and Reduction; brief-pinned, candidate 1 of the ordered list; raised by emission-line-rail (mark-form state, one rail) and busytown (every label states a fact). Seed key 01ce4315.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
