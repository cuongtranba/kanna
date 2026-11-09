---
target: c3-231
scope: insert
base: c3-231#n13779@v1:sha256:af86a2523171ce2100989e5cdf43408957f4c7d723d9e30aa7fcddae8fb550b2
---
| ClaudeCliCommands | OUT | record(SDK rows) keeps builtin rows only, drops names starting with an underscore, ignores empty or identical lists, saves and notifies; list() returns the server-wide SlashCommand[] with scope cli. Fed by supportedCommands() at Claude session start and by commands\_changed pushes; loaded from claude-cli-commands.json in the data dir at boot so the picker is complete before any session runs | c3-210 | src/server/claude-cli-commands.ts |
