import { describe, expect, test } from "vite-plus/test"
import { makeFakeCommandPort } from "../adapters/testing/makeFakePorts"
import type { CommandPort } from "../ports/commandPort"
import { isPendingAction } from "../stores/pendingActionsStore"
import { archiveActionKey, archiveInboxThreads } from "./inboxActions"
import type { InboxToastPort, InboxToastRequest } from "./inboxToast"
import { waitFor } from "./testing/waitFor"

function recordingCommandPort() {
  const port = makeFakeCommandPort(() => ({ ok: true }))
  return { port, sent: port.calls }
}

function recordingToasts() {
  const shown: InboxToastRequest[] = []
  const toast: InboxToastPort = { show: (request) => shown.push(request) }
  return { toast, shown }
}

describe("archiveInboxThreads", () => {
  test("archives the selected threads in one command, then offers Undo that unarchives each of them", async () => {
    const { port, sent } = recordingCommandPort()
    const { toast, shown } = recordingToasts()
    let archived = 0

    archiveInboxThreads(port, ["a", "b"], () => { archived += 1 }, toast)
    await waitFor(() => shown.length === 1, 2000, "the Archived toast")

    expect(sent).toEqual([{ type: "inbox.archive", threadIds: ["a", "b"] }])
    expect(archived).toBe(1)
    expect(shown[0]).toMatchObject({ title: "Archived 2 threads", actionLabel: "Undo" })

    shown[0]?.onAction()
    await waitFor(() => sent.length === 3, 2000, "the unarchive commands")
    expect(sent.slice(1)).toEqual([
      { type: "inbox.unarchive", threadId: "a" },
      { type: "inbox.unarchive", threadId: "b" },
    ])
  })

  test("a single thread says Archived and a failed archive offers no Undo", async () => {
    const { toast, shown } = recordingToasts()
    const { port } = recordingCommandPort()
    archiveInboxThreads(port, ["a"], () => {}, toast)
    await waitFor(() => shown.length === 1, 2000, "the Archived toast")
    expect(shown[0]?.title).toBe("Archived")

    const failing: CommandPort = { command: async () => { throw new Error("offline") } }
    const failedToasts = recordingToasts()
    archiveInboxThreads(failing, ["b"], () => {}, failedToasts.toast)
    await waitFor(() => !isPendingAction(archiveActionKey(["b"])), 2000, "the failed archive to settle")
    expect(failedToasts.shown).toEqual([])
  })
})
