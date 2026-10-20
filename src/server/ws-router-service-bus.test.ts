import { describe, expect, test } from "bun:test"
import type { ServerEnvelope } from "../shared/protocol"
import { handleServiceBusCommand } from "./ws-router-service-bus"

describe("handleServiceBusCommand", () => {
  test("resets the store and acknowledges", async () => {
    const sent: ServerEnvelope[] = []
    let resets = 0
    const handled = await handleServiceBusCommand(
      { resetStore: async () => { resets += 1 } },
      (envelope) => sent.push(envelope),
      { type: "serviceBus.resetStore" },
      "r1",
    )

    expect(handled).toBe(true)
    expect(resets).toBe(1)
    expect(sent).toEqual([{ v: 1, type: "ack", id: "r1", result: { ok: true } }])
  })

  test("leaves other commands to the next handler", async () => {
    expect(await handleServiceBusCommand(undefined, () => undefined, { type: "system.ping" }, "r1")).toBe(false)
  })

  test("surfaces a failed reset to the caller instead of acknowledging", async () => {
    const sent: ServerEnvelope[] = []
    await expect(
      handleServiceBusCommand(
        { resetStore: async () => { throw new Error("Reset store only applies to the embedded server") } },
        (envelope) => sent.push(envelope),
        { type: "serviceBus.resetStore" },
        "r1",
      ),
    ).rejects.toThrow("embedded")
    expect(sent).toEqual([])
  })
})
