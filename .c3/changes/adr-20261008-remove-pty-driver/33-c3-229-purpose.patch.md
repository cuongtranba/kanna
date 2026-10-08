---
target: c3-229
scope: block
base: c3-229#n12288@v1:sha256:6728e6c117ef6fb0b257996d7e08a1626bd65af1f2b7f843ff04cd2146e71240
---
Owns the workflow sidecar read-model lifecycle: receives `register(chatId, dir)` / `unregister(chatId)` calls from the agent coordinator (c3-210), which derives the directory from the SDK session token, delegates all IO to `workflow-watch-io.adapter.ts` (the sole adapter), maintains per-chat WorkflowsSnapshot in memory, and notifies subscribers on every disk change. Also owns the `workflow` ToolKind normalization in `src/shared/tools.ts` that converts the `Workflow` tool_use transcript entry into a hydrated inline card for the UI. Non-goals: emitting Kanna JSONL events for workflow state, driving turn lifecycle, writing to disk.
