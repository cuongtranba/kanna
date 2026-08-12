---
target: c3-231
scope: block
base: c3-231#n9919@v1:sha256:0e9ba2e279dc50070e130c5d255fab6bf581e3290d774170d16a9a9bf63cac37
---
| Primary path | The project-commands envelope reads the list synchronously per project; every scope is surfaced, no CLI merge, no async load. Its consumer `localCommandsForCwd` prepends Kanna's static `BUILTIN_SLASH_COMMANDS` (`/clear`, `/compact`) and drops any disk entry sharing a builtin name, since dispatch intercepts that name before the CLI sees it. `LocalCatalogService.list(cwd)` is unchanged — it still returns disk entries only | c3-208 |
