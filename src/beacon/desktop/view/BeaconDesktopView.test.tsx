import { afterEach, expect, test } from "bun:test"
import { act } from "react"
import "../../../client/lib/testing/setupHappyDom"
import { renderForLoopCheck } from "../../../client/lib/testing/renderForLoopCheck"
import { DEFAULT_BEACON_SCOPE } from "../../../shared/beacon-scope"
import type { BeaconActivity } from "../../activity"
import type { DesktopRequests, DesktopView } from "../desktop-types"
import { desktopStrings } from "../strings"
import { BeaconDesktopView } from "./BeaconDesktopView"
import type { DesktopBridge, DesktopRequestName } from "./bridge"
import { useDesktopViewStore } from "./view-store"

const OLD: BeaconActivity = { id: "old", at: 1_000, verb: "read", target: "C:\\notes.txt", outcome: { kind: "done" } }
const NEW: BeaconActivity = { id: "new", at: 2_000, verb: "run", target: "git status", outcome: { kind: "exit", code: 1 } }

const HOME: DesktopView = {
  os: "windows",
  machine: "LINH-LAPTOP",
  screen: { kind: "home" },
  pairing: { kannaUrl: "https://kanna.example.com", beaconId: "b-1" },
  runner: { status: { phase: "online", since: 500 }, scope: { ...DEFAULT_BEACON_SCOPE, readRoots: ["D:\\Projects"] }, scopeSync: true },
  activity: [OLD],
  prefs: { paused: false, launchAtLogin: true },
  notice: null,
  busy: { unpairing: false, launchAtLogin: false },
}

function createBridge(initial: DesktopView) {
  let push: (view: DesktopView) => void = () => {}
  const requests: DesktopRequestName[] = []
  const bridge: DesktopBridge = {
    request<K extends DesktopRequestName>(name: K): Promise<DesktopRequests[K]["response"]> {
      requests.push(name)
      const responses: { [Name in DesktopRequestName]: DesktopRequests[Name]["response"] } = {
        getView: initial,
        submitPairingInput: { ok: true },
        confirmPairing: { ok: true },
        cancelPairing: { ok: true },
        openGrant: { ok: true },
        closeGrant: { ok: true },
        applyGrant: { ok: true },
        pickFolders: { paths: [] },
        setPaused: { ok: true },
        setLaunchAtLogin: { ok: true },
        unpair: { ok: true },
        dismissNotice: { ok: true },
        openExternal: { ok: true },
      }
      return Promise.resolve(responses[name])
    },
    onView(listener) {
      push = listener
      return () => {}
    },
    announceLocale: () => {},
  }
  return { bridge, requests, push: (view: DesktopView) => push(view) }
}

afterEach(() => {
  useDesktopViewStore.setState({ view: null, liveSince: Number.POSITIVE_INFINITY, draft: null, menuOpen: false, confirmingUnpair: false })
})

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label || candidate.getAttribute("aria-label") === label,
  )
  if (!found) throw new Error(`no button ${label}`)
  return found
}

test("the record animates only rows that arrive after the window opened", async () => {
  const { bridge, push } = createBridge(HOME)
  const result = await renderForLoopCheck(<BeaconDesktopView bridge={bridge} strings={desktopStrings("en")} locale="en" />)
  expect(result.loopWarnings).toEqual([])
  expect(document.querySelectorAll(".bd-entry-fresh")).toHaveLength(0)
  await act(async () => push({ ...HOME, activity: [NEW, OLD] }))
  const fresh = Array.from(document.querySelectorAll(".bd-entry-fresh")).map((row) => row.textContent)
  expect(fresh).toHaveLength(1)
  expect(fresh[0]).toContain("git status")
  await result.cleanup()
})

test("unpair asks inline, focuses Cancel, and Cancel hands focus back to the menu button", async () => {
  const { bridge, requests } = createBridge(HOME)
  const result = await renderForLoopCheck(<BeaconDesktopView bridge={bridge} strings={desktopStrings("en")} locale="en" />)
  await act(async () => button("More").click())
  await act(async () => button("Unpair this computer").click())
  expect(document.activeElement?.textContent).toBe("Cancel")
  await act(async () => button("Cancel").click())
  expect(document.activeElement?.getAttribute("aria-label")).toBe("More")
  expect(requests).not.toContain("unpair")
  await result.cleanup()
})

test("Vietnamese copy renders on the record", async () => {
  const { bridge } = createBridge(HOME)
  const result = await renderForLoopCheck(<BeaconDesktopView bridge={bridge} strings={desktopStrings("vi")} locale="vi" />)
  expect(document.body.textContent).toContain("Nhật ký")
  expect(document.body.textContent).toContain("Đã kết nối")
  await result.cleanup()
})
