---
target: c3-210
scope: insert
base: c3-210#n10669@v1:sha256:b4604fbac4fe9bf9fe2402344b6f3ce7cd31d28d80a2c4e36741bfe337106c54
---
| Local slash-command expansion | IN | For a provider whose harness cannot resolve `/name` itself — everything `providerExpandsSlashCommands` does not list, so codex today and any provider added later by default — `resolveSlashExpansion` resolves the line against c3-231 and starts the turn with `StartTurnForChatArgs.promptOverride` carrying the file's instructions while `content` stays the line the user typed. Dispatched from the two sites that already dispatch builtins: `sendCommand` AFTER `parseBuiltinCommand` (so `/clear` is never shadowed by a project command of that name) and after the `isChatBusy` branch (so a `/skill` typed mid-turn queues), and `dequeueAndStartQueuedMessage` for non-steered messages only. Every failure — unknown name, unreadable file, empty body, no catalog — returns null and the message is sent exactly as typed. See adr-20260905-provider-agnostic-slash-commands | c3-231 | src/server/claude-send-command.ts, src/server/skill-invocation.ts, src/server/claude-turn-starter.ts |
