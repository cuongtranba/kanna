---
target: c3-229
scope: block
base: c3-229#n12331@v1:sha256:defcbc0579d6f1d1b63d17d408ba7fcf915ffdfbf0364549e9bf3f4fdd61e63c
---
| WorkflowRegistry.getAgentTranscript(chatId, runId, agentId) | OUT | Read + parse one workflow agent's full transcript (subagents/workflows/<runId>/agent-<id>.jsonl) into TranscriptEntry[] via normalizeClaudeStreamMessage per line — NOT createJsonlEventParser (which drops the isSidechain:true lines the agent files are entirely made of); never feeds the turn/event pipeline (c3-210); returns [] for an unknown chat or missing IO/file | c3-208 | src/server/workflow-registry.ts |
