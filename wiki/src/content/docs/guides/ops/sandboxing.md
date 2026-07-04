---
title: PTY spawn smoke-test
description: How the PTY driver gates each spawn, and what replaced the old sandbox.
---

## What runs on each PTY spawn

When `KANNA_CLAUDE_DRIVER=pty`, every spawn first passes a single TUI **smoke test**. Kanna probes the spawned `claude` to confirm that `--disallowedTools Bash` is honored — that the model genuinely cannot reach the Bash built-in. PASS unlocks the spawn; FAIL refuses it with a clear reason on the normal spawn-error path.

The verdict is cached for 24 hours, keyed on `(binarySha256, model)`, under `${HOME}/.kanna/cache/smoke-test/`. It invalidates automatically when the `claude` CLI binary changes.

## The sandbox and preflight were removed

Older builds wrapped each PTY spawn in an OS-level sandbox (`sandbox-exec` on macOS, `bwrap` on Linux) and ran an 8-probe allowlist "preflight" against every disallowed built-in. **Both are gone.**

- `KANNA_PTY_SANDBOX` — inert (sandbox removed).
- `KANNA_PTY_PREFLIGHT_MODEL` — inert (preflight replaced by the smoke test).
- `KANNA_PTY_TRANSCRIPT_WATCH` — inert (the transcript follower always tail-polls; there is no `fs.watch` to toggle).

Setting any of these has no effect. You can remove them from your environment.

## Getting isolation today

If you need stronger isolation than process separation:

- Run each chat in a **[git worktree](/features/projects-sessions/)** so file changes stay scoped to a throwaway working tree.
- Run Kanna itself inside a dedicated VM or container with no host credential access.
- Keep `AskUserQuestion` / `ExitPlanMode` routed through the durable approval protocol (always on under PTY) so plan and question gates stay in your hands.
