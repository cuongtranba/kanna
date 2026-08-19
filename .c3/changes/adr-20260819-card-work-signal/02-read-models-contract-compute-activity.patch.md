---
target: c3-207
scope: block
base: c3-207#n9619@v1:sha256:6f0724e54daffc6916e15e601a01638736a3372afca237f76a50bf3d43802dc9
---
| computeChatActivity(chatId, deps) | OUT | Pure function deriving ChatActivity from live state plus injected registries; consumed by deriveSidebarData; lastFailure is derived from the chat record's lastTurnOutcome plus ChatRecord.lastTurnError (folded from turn_failed, cleared at the next turn_started / turn_finished / turn_cancelled) and published as the error's FIRST line capped at 120 chars, null when that line is empty | c3-208 | src/server/read-models.ts |
