---
title: Sandboxing
description: Toggle and tune the PTY sandbox.
---

## When the sandbox runs

Every `KANNA_CLAUDE_DRIVER=pty` spawn is wrapped in an OS-level sandbox when supported (macOS `sandbox-exec`, Linux `bwrap`). Default **on**.

## Toggle off

```bash
export KANNA_PTY_SANDBOX=off
```

You lose defense-in-depth against built-in tool credential reads. Only do this if you have an alternative isolation layer (e.g., dedicated VM, container with no host access).

## Linux without bwrap

If `bwrap` is not installed, sandbox silently disables. To suppress the gap explicitly:

```bash
sudo apt install bubblewrap          # Debian/Ubuntu
sudo pacman -S bubblewrap            # Arch
sudo dnf install bubblewrap          # Fedora
```

Or set `KANNA_PTY_SANDBOX=off` to acknowledge the gap.

## Allowlist preflight cache

`KANNA_PTY_PREFLIGHT_MODEL` overrides the model used for the 8 directed probes. Defaults to `claude-haiku-4-5-20251001` for cost and speed. Probes burn subscription turns — do not change unless you understand the cost.

Cache TTL: 24 hours, keyed on `(binarySha256, tools-string, model)`. Invalidates automatically when the `claude` CLI is updated.
