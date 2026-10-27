import { expect, test } from "vite-plus/test"
import { readInboxPage } from "./inboxCommands"

test("reads an inbox page ack and refuses anything that is not one", () => {
  expect(readInboxPage({ threads: [{ id: "t1" }], items: [] }).threads).toHaveLength(1)
  expect(() => readInboxPage({ threads: [{ nope: 1 }], items: [] })).toThrow()
  expect(() => readInboxPage("ok")).toThrow()
})
