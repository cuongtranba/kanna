---
target: c3-231
scope: block
base: c3-231#n13748@v1:sha256:9aaf0ac343a1d7cb9bfc65170528c9130661a64439e82db577add6d9ba970f01
---
Owns the disk scan + dedupe + cache that turns raw `SKILL.md` and `.md` command files into typed projections: the `SlashCommand[]` the `/` picker offers, the winning entry a typed `/name` resolves to (including its file path), and the skill roster a provider with no skill machinery of its own is told about. One scan backs all three. It also owns the merge that puts Claude Code's own built-in commands (recorded from live sessions by the CLI command catalog, scope `cli`) into the picker list between Kanna's builtins and the disk entries. Non-goals: drive the picker UI, expand or run a command, watch filesystem changes mid-session, route claude CLI commands (a typed `/name` still goes to the CLI untouched).
