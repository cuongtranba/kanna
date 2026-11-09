---
target: c3-231
scope: block
base: c3-231#n13761@v1:sha256:4165cb2aa5e0a6458a94e09d37dfc5a67f096136e04e37e00ecbbf3de6b07027
---
| Primary path | The project-commands envelope reads the list synchronously per project; every scope is surfaced, no async load. Its consumer localCommandsForCwd returns Kanna's static BUILTIN\_SLASH\_COMMANDS (/clear, /compact, /cron), then the Claude Code built-ins held by the CLI command catalog (scope cli), then disk entries, dropping CLI and disk entries that share a Kanna builtin name, since dispatch intercepts that name before the CLI sees it. Disk entries sharing a CLI name stay, because the client hides scope cli for providers whose harness does not resolve /name itself. LocalCatalogService.list(cwd) is unchanged — it still returns disk entries only | c3-208 |
