import { describe, expect, test } from "bun:test"
import type { ChatAttachment, HydratedTranscriptMessage } from "../../shared/types"
import { findRetryPromptForResult } from "./retryPrompt"

function prompt(
  id: string,
  content: string,
  attachments?: ChatAttachment[],
): HydratedTranscriptMessage {
  return {
    kind: "user_prompt",
    id,
    timestamp: new Date(0).toISOString(),
    content,
    ...(attachments ? { attachments } : {}),
  }
}

function result(id: string): HydratedTranscriptMessage {
  return {
    kind: "result",
    id,
    timestamp: new Date(0).toISOString(),
    success: false,
    result: "Selected model is at capacity.",
    durationMs: 10,
  }
}

function assistant(id: string): HydratedTranscriptMessage {
  return { kind: "assistant_text", id, timestamp: new Date(0).toISOString(), text: "thinking" }
}

const attachment: ChatAttachment = {
  id: "att-1",
  kind: "image",
  displayName: "shot.png",
  absolutePath: "/tmp/shot.png",
  relativePath: "shot.png",
  contentUrl: "/attachments/att-1",
  mimeType: "image/png",
  size: 12,
}

describe("findRetryPromptForResult", () => {
  test("returns the nearest preceding prompt with its attachments", () => {
    const messages = [
      prompt("p1", "first ask"),
      result("r1"),
      prompt("p2", "second ask", [attachment]),
      assistant("a1"),
      result("r2"),
    ]

    expect(findRetryPromptForResult(messages, "r2")).toEqual({
      content: "second ask",
      attachments: [attachment],
    })
  })

  test("ignores prompts that come after the failed result", () => {
    const messages = [
      prompt("p1", "first ask"),
      result("r1"),
      prompt("p2", "later ask"),
    ]

    expect(findRetryPromptForResult(messages, "r1")).toEqual({
      content: "first ask",
      attachments: [],
    })
  })

  test("returns null when no prompt precedes the result", () => {
    expect(findRetryPromptForResult([assistant("a1"), result("r1")], "r1")).toBeNull()
  })

  test("returns null when the result id is not in the list", () => {
    expect(findRetryPromptForResult([prompt("p1", "ask"), result("r1")], "missing")).toBeNull()
  })

  test("skips a blank prompt carrying neither text nor attachments", () => {
    const messages = [
      prompt("p1", "real ask"),
      prompt("p2", "   "),
      result("r1"),
    ]

    expect(findRetryPromptForResult(messages, "r1")).toEqual({
      content: "real ask",
      attachments: [],
    })
  })

  test("accepts an attachment-only prompt with empty text", () => {
    const messages = [prompt("p1", "", [attachment]), result("r1")]

    expect(findRetryPromptForResult(messages, "r1")).toEqual({
      content: "",
      attachments: [attachment],
    })
  })
})
