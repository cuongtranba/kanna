import { describe, expect, test } from "vite-plus/test"
import { renderToStaticMarkup } from "react-dom/server"
import { ChatPolicyDialogStore } from "./ChatPolicyDialog.store"

type PolicyDialogApi = ReturnType<typeof ChatPolicyDialogStore.useScopedStoreApi>

function Capture({ onApi }: { onApi: (api: PolicyDialogApi) => void }) {
  onApi(ChatPolicyDialogStore.useScopedStoreApi())
  return null
}

function mountStore(initialDefaultAction: "ask" | "auto-allow" | "auto-deny") {
  let captured: PolicyDialogApi | null = null
  renderToStaticMarkup(
    <ChatPolicyDialogStore.Provider
      init={{ initialDefaultAction, initialReadDenyText: "", initialWriteDenyText: "" }}
    >
      <Capture onApi={(api) => { captured = api }} />
    </ChatPolicyDialogStore.Provider>,
  )
  if (!captured) throw new Error("store was not captured")
  return captured as PolicyDialogApi
}

describe("ChatPolicyDialogStore default action", () => {
  test("auto-allow is staged for confirmation instead of applied", () => {
    const store = mountStore("ask")
    store.getState().requestDefaultAction("auto-allow")
    expect(store.getState().pendingDefaultAction).toBe("auto-allow")
    expect(store.getState().defaultAction).toBe("ask")
  })

  test("confirming applies the staged action and closes the confirmation", () => {
    const store = mountStore("ask")
    store.getState().requestDefaultAction("auto-allow")
    store.getState().confirmPendingDefaultAction()
    expect(store.getState().defaultAction).toBe("auto-allow")
    expect(store.getState().pendingDefaultAction).toBeNull()
  })

  test("cancelling leaves the action unchanged and closes the confirmation", () => {
    const store = mountStore("ask")
    store.getState().requestDefaultAction("auto-allow")
    store.getState().cancelPendingDefaultAction()
    expect(store.getState().defaultAction).toBe("ask")
    expect(store.getState().pendingDefaultAction).toBeNull()
  })

  test("other actions apply immediately", () => {
    const store = mountStore("ask")
    store.getState().requestDefaultAction("auto-deny")
    expect(store.getState().defaultAction).toBe("auto-deny")
    expect(store.getState().pendingDefaultAction).toBeNull()
  })

  test("re-selecting the current auto-allow needs no confirmation", () => {
    const store = mountStore("auto-allow")
    store.getState().requestDefaultAction("auto-allow")
    expect(store.getState().pendingDefaultAction).toBeNull()
  })
})
