import { describe, expect, test } from "vite-plus/test"
import { LOG_OF_EVENT } from "../events"
import { STORE_EVENT_SUBJECT } from "./store-event-subjects"

describe("store event subjects", () => {
  test("every persisted event kind has an explicit subject decision", () => {
    expect(new Set(Object.keys(STORE_EVENT_SUBJECT))).toEqual(new Set(Object.keys(LOG_OF_EVENT)))
  })

  test("kinds that carry session secrets or per-token noise are not published", () => {
    const silent = [
      "session_token_set",
      "pending_fork_session_token_set",
      "chat_source_hash_set",
      "chat_read_state_set",
      "chat_compact_failures_set",
      "sidebar_project_order_set",
      "message_appended",
      "subagent_message_delta",
      "subagent_entry_appended",
    ] as const
    for (const kind of silent) {
      expect(STORE_EVENT_SUBJECT[kind]).toBeNull()
    }
  })

  test("every published subject is a two-token name that is safe to match against", () => {
    for (const subject of Object.values(STORE_EVENT_SUBJECT)) {
      if (subject === null) continue
      expect(subject).toMatch(/^[a-z][A-Za-z]*\.[A-Za-z]+$/)
    }
  })
})
