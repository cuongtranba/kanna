import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { ProcessedLoopDisarmedMessage } from "./types"
import { LoopDisarmedMessage } from "./LoopDisarmedMessage"

const base = { id: "m-1", timestamp: "2026-08-30T00:00:00Z" }

function render(message: Omit<ProcessedLoopDisarmedMessage, "id" | "timestamp" | "kind">) {
  return renderToStaticMarkup(
    <LoopDisarmedMessage message={{ ...base, kind: "loop_disarmed", ...message }} />,
  )
}

describe("LoopDisarmedMessage", () => {
  // The whole point of the card: a user message disarms an armed loop, and
  // that used to leave no trace at all.
  test("user_send names the user's own message as the thing that stopped the loop", () => {
    const html = render({ reason: "user_send", resumable: false })
    expect(html).toContain("Loop stopped by your message")
    expect(html).toContain("Your message took over the armed loop")
    expect(html).toContain("never resumes a loop")
  })

  test("repeated_failures says the host stopped it", () => {
    const html = render({ reason: "repeated_failures", resumable: true })
    expect(html).toContain("Loop stopped after repeated failures")
    expect(html).toContain("iterations kept failing")
  })

  test("goal_met reads as a normal finish, not a failure", () => {
    const html = render({ reason: "goal_met", resumable: false })
    expect(html).toContain("Loop finished")
    expect(html).toContain("The goal was met")
    expect(html).not.toContain("failing")
  })

  test("chat_deleted stays minimal", () => {
    const html = render({ reason: "chat_deleted", resumable: false })
    expect(html).toContain("Loop disarmed")
    expect(html).toContain("The chat was deleted.")
  })

  // A review once read the wrong plan in the wrong checkout because nothing
  // recorded either.
  test("shows the tracking file and the worktree it ran in", () => {
    const html = render({
      reason: "user_send",
      resumable: true,
      trackingFileRel: "PROGRESS-panes.md",
      workdirAbs: "/Users/dev/kanna-panes",
    })
    expect(html).toContain("PROGRESS-panes.md")
    expect(html).toContain("/Users/dev/kanna-panes")
  })

  test("omits the location block when neither path was recorded", () => {
    const html = render({ reason: "user_send", resumable: false })
    expect(html).not.toContain("Worktree")
    expect(html).not.toContain("Plan ")
  })

  test("resumable names the resume_loop tool", () => {
    const html = render({ reason: "user_send", resumable: true })
    expect(html).toContain("resume_loop")
    expect(html).toContain("can be re-armed")
  })

  test("non-resumable offers no re-arm affordance", () => {
    const html = render({ reason: "user_send", resumable: false })
    expect(html).not.toContain("resume_loop")
  })

  // No client action is wired for re-arming yet, so the card must not grow a
  // dead button.
  test("renders no interactive control", () => {
    const html = render({ reason: "repeated_failures", resumable: true })
    expect(html).not.toContain("<button")
  })

  // DESIGN.md: native `title` is banned as a hover surface; the project
  // Tooltip is the replacement.
  test("uses no native title attribute", () => {
    const html = render({
      reason: "goal_met",
      resumable: true,
      trackingFileRel: "PROGRESS.md",
      workdirAbs: "/Users/dev/kanna",
    })
    expect(html).not.toContain("title=")
  })
})
