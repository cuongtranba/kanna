---
target: c3-249
scope: insert
base: c3-249#n14782@v1:sha256:3b179685b1468f7cbdf92f49c4aa2f0a885023238ef80bff260b7fc938640ff3
---
| Mid-turn delivery | OUT | Claude: pushed with the queued id as SDK uuid; the replay echo records the user_prompt entry and releases the message, adopts a CLI-started turn, and an unechoed message returns to the queue 15 seconds after the turn ends. Codex: turn/steer, recorded and released on success | A chat holding an unechoed injection is busy; Stop closes a Claude session that holds one so the CLI cannot run it after Stop | src/server/peer-messaging/mid-turn-delivery.ts |
