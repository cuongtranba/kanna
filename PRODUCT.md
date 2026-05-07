# Product

## Register

product

## Users

Solo developers running Claude Code or Codex CLIs on their own machine for focused, multi-hour sessions. They jump between many chats and projects, expect keyboard-first navigation with mouse fallbacks, and watch agents work for long stretches while occasionally steering. Context is a quiet desk on a real monitor, not a phone. They came to Kanna because the raw CLI made long sessions hard to track; they stay because the UI makes the work legible without getting in the way.

## Product Purpose

Kanna is a web UI for the Claude Code and Codex CLIs that makes long agent sessions tractable. It surfaces project structure, chat status, transcripts, tool calls, plan-mode prompts, and background work as a single calm, navigable workspace. Success looks like: a developer running three agents across two projects can tell at a glance what each is doing, jump in to steer any of them, never lose work to a forgotten background process, and trust what the transcript shows.

## Brand Personality

Editorial, thoughtful, warm. Voice: confident without swagger; explains state, never performs it. Closer to a well-edited document than a control panel. Quiet typography does the heavy lifting. Color is restrained and tinted toward warm neutrals, never the icy grays of generic devtools.

## Anti-references

- **Generic AI SaaS gradient** — purple-blue hero gradients, glassmorphism cards, glow accents, ChatGPT-clone chrome.
- **Marketing-heavy SaaS-cream** — cream backgrounds, hero illustrations, "feature card" grids, oversized CTA buttons.
- **Neon terminal cyberpunk** — black background plus saturated green/cyan accents; hacker-aesthetic chrome.
- **Cluttered devtool dashboards** — Datadog/Grafana density: every pixel a panel, no breathing room, no hierarchy.

Reference for the right feel: **Notion**. Warm neutrals, content-first, calm density, editorial type discipline.

## Design Principles

1. **Workflow over wow.** Design serves the developer's task; it never performs. If a flourish does not help someone steer an agent faster, cut it.
2. **Calm density.** Show a lot of state at once, but with breathing room, weighted hierarchy, and warmth. Density without rhythm is clutter.
3. **Editorial typography earns hierarchy.** Scale, weight, and spacing carry meaning. No decorative gradients, no glow, no chrome substituting for type.
4. **Keyboard-first, mouse-friendly.** Every action reachable from the keyboard. Every keyboard action also reachable from a clear mouse target. No dead-ends in either direction.
5. **Trust via legibility.** Agent output, tool calls, and background processes read like documents you can audit — not log dumps, not loading spinners. The user must always be able to verify what is happening.

## Accessibility & Inclusion

Target WCAG 2.1 AAA where feasible, AA as the floor. Specifically:

- Contrast ≥ 7:1 for body text and ≥ 4.5:1 for large text where the design allows; never below AA.
- Full keyboard navigation including all destructive actions (e.g. stopping background tasks).
- Visible focus rings on every interactive element; never `outline: none` without a replacement.
- Respect `prefers-reduced-motion`: disable non-essential transitions and any directional motion.
- Color is never the only signal — pair with icon, label, or weight (status, errors, running/stopped states).
- Tabular numerics (`font-variant-numeric: tabular-nums`) for any timing, count, or status duration.
