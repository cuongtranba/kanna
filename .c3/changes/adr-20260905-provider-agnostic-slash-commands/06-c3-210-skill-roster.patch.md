---
target: c3-210
scope: insert
base: c3-210#n10669@v1:sha256:b4604fbac4fe9bf9fe2402344b6f3ce7cd31d28d80a2c4e36741bfe337106c54
---
| Codex skill roster | OUT | `StartTurnDeps.listSkills(chatId)` feeds c3-231's skill list into `buildCodexDeveloperInstructions` on the Codex branch of the spawn, naming each skill's absolute `SKILL.md` path so reading it IS the invocation — c3-211's protocol can declare no tool. The Claude branch never passes it: the CLI discovers skills itself. Applied at `thread/start`, and `startSession` reuses a live session on a cwd match, so a skill authored mid-chat reaches the model at the next session start | c3-211 | src/server/claude-turn-starter.ts, src/shared/kanna-system-prompt.ts |
