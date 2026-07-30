import { describe, expect, test } from "bun:test"
import { useFollowedSessionsStore, selectIsFollowing } from "./followedSessionsStore"

describe("followedSessionsStore", () => {
  test("setFollowed stores ids; selectIsFollowing reflects membership", () => {
    useFollowedSessionsStore.getState().setFollowed(["chat-1", "chat-2"])
    expect(selectIsFollowing("chat-1")(useFollowedSessionsStore.getState())).toBe(true)
    expect(selectIsFollowing("chat-3")(useFollowedSessionsStore.getState())).toBe(false)
  })
  test("selectIsFollowing returns false for null/undefined chatId", () => {
    useFollowedSessionsStore.getState().setFollowed(["chat-1"])
    expect(selectIsFollowing(null)(useFollowedSessionsStore.getState())).toBe(false)
    expect(selectIsFollowing(undefined)(useFollowedSessionsStore.getState())).toBe(false)
  })
  test("setFollowed with unchanged ids does not need a stable ref (primitive selector)", () => {
    useFollowedSessionsStore.getState().setFollowed(["chat-1"])
    const a = selectIsFollowing("chat-1")(useFollowedSessionsStore.getState())
    const b = selectIsFollowing("chat-1")(useFollowedSessionsStore.getState())
    expect(a).toBe(b)
    expect(a).toBe(true)
  })
})
