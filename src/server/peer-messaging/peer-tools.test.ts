import { expect, test } from "vite-plus/test"
import { createCodexKannaTools } from "./peer-tools"
import { PeerMessenger } from "./peer-messenger"

function idleMessenger(): PeerMessenger {
  return new PeerMessenger({
    listChats: () => [],
    getChat: () => null,
    activeStatuses: () => new Map(),
    queuedMessages: () => [],
    globalInbound: () => "accept",
    enqueue: async () => "queued-1",
    startNextQueued: async () => {},
    injectMidTurn: async () => false,
    after: (_delayMs, run) => {
      queueMicrotask(run)
      return () => {}
    },
    now: () => 0,
    newId: () => "id-1",
  })
}

test("Codex chats are offered the wait tool, and a wait nobody answers returns a timeout", async () => {
  const tools = createCodexKannaTools(idleMessenger())
  expect(tools.specs.map((spec) => spec.name)).toEqual(["list_peer_chats", "send_chat_message", "wait_for_chat_message"])
  const result = await tools.call("chat-1", "wait_for_chat_message", { timeout_seconds: 5 })
  expect(result).toEqual({ text: JSON.stringify({ status: "timeout" }), isError: false })
})
