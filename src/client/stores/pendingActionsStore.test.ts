import { expect, test } from "bun:test"
import { isPendingAction, pendingActionKey, runPendingAction, usePendingActionsStore } from "./pendingActionsStore"

function deferred() {
  let resolve: () => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function settled(key: string) {
  while (isPendingAction(key)) await Promise.resolve()
}

test("an action reads as pending until its promise resolves", async () => {
  const key = pendingActionKey("chat.archive", "resolves")
  const gate = deferred()
  runPendingAction(key, () => gate.promise)
  expect(isPendingAction(key)).toBe(true)
  gate.resolve()
  await settled(key)
  expect(isPendingAction(key)).toBe(false)
})

test("a rejected action stops reading as pending", async () => {
  const key = pendingActionKey("chat.archive", "rejects")
  const gate = deferred()
  runPendingAction(key, () => gate.promise)
  gate.reject(new Error("server refused"))
  await settled(key)
  expect(isPendingAction(key)).toBe(false)
})

test("a second trigger while the first is in flight does not run the action again", async () => {
  const key = pendingActionKey("chat.archive", "double-click")
  const gate = deferred()
  let runs = 0
  const action = () => {
    runs += 1
    return gate.promise
  }
  runPendingAction(key, action)
  runPendingAction(key, action)
  gate.resolve()
  await settled(key)
  expect(runs).toBe(1)
  expect(usePendingActionsStore.getState().inFlight).toEqual({})
})
