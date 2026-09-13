# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo developers run Claude Code or Codex CLIs on their own machines for focused, multi-hour sessions. They move between many chats and projects, prefer keyboard-first navigation with mouse fallbacks, and watch agents work for long stretches while occasionally steering. Their usual setting is a quiet desk and a real monitor, not a phone.

## Product Purpose

Kanna is a web UI for the Claude Code and Codex CLIs that makes long agent sessions tractable. It surfaces project structure, chat status, transcripts, tool calls, plan-mode prompts, and background work as one calm, navigable workspace. Success is a developer running three agents across two projects who can tell what each is doing, steer any of them, avoid losing work to a forgotten background process, and trust the transcript.

## Positioning

Kanna turns otherwise opaque CLI agent work into a local, navigable workspace: project and session state, agent output, background work, and intervention controls stay visible together instead of being spread across terminal windows and forgotten processes.

## Operating Context

The product is used during real software work, often across several local repositories and long-running agent sessions. A developer watches live state, reads transcripts and tool activity, jumps between chats, and intervenes when an agent needs direction. Worktree isolation and local project context let active work continue without disturbing a developer's primary checkout.

## Capabilities and Constraints

The following implementation facts are inferred from the repository and README and should be confirmed before they become a new product commitment:

- The app supports Claude, Codex, and OpenRouter-backed chats, real-time WebSocket updates, local project discovery, transcript export, worktree isolation, and responsive PWA use.
- It provides agent steering, plan-mode prompts, background-task visibility, subagent orchestration, OAuth token pooling, custom MCP servers, and configurable notifications.
- The app is local-first and may be password-protected; it preserves subscription billing for the optional Claude PTY driver.

Open product decisions: no pricing, licensing, deployment, customer, benchmark, or external proof claims are recorded here.

## Brand Commitments

Kanna is editorial, thoughtful, and warm. Its voice is confident without swagger: it explains state rather than performing it. It is closer to a well-edited document than a control panel, with quiet typography and restrained warm neutrals.

The product rejects generic AI-SaaS gradient chrome, marketing-heavy cream landing-page treatment, neon terminal cyberpunk, and cluttered devtool dashboards. Notion is a reference for warm neutrals, content-first presentation, and calm density.

## Evidence on Hand

- The runnable product and source live in this repository; `README.md` documents its implemented capabilities and operating model.
- `assets/screenshot.png` and `assets/screenshot-light.png` are current product screenshots.
- `DESIGN.md` records the incumbent visual system.

No customer testimonials, case studies, pricing evidence, or performance benchmarks are supplied. Future work must not fabricate them.

## Product Principles

1. **Workflow over spectacle.** The interface serves agent supervision and intervention; decoration that does not make that work easier does not belong.
2. **Calm density.** The product can show substantial live state without collapsing hierarchy or rhythm.
3. **Keyboard-first, mouse-friendly.** Every important action is reachable by keyboard and has a clear mouse affordance.
4. **Trust through legibility.** Transcripts, tool calls, and background state must be inspectable rather than opaque or ornamental.
5. **Local work stays under the developer's control.** Project context and concurrent work should remain visible and isolated from the primary checkout when needed.

## Accessibility & Inclusion

Target WCAG 2.1 AAA where feasible and AA as the floor. Body text targets at least 7:1 contrast where the design allows and never falls below AA. Every interactive element needs a visible focus ring, destructive actions must remain keyboard-accessible, and reduced-motion preferences must be respected. Color never carries state alone; labels, icons, shape, or weight accompany it. Durations, counts, ages, and status timings use tabular numerics to avoid reflow.
