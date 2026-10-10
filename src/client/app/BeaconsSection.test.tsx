import { afterEach, expect, test } from "bun:test"
import { act } from "react"
import "../lib/testing/setupHappyDom"
import { makeFakeClipboardPort, makeFakeTimerPort } from "../adapters/testing/makeFakePorts"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { DEFAULT_BEACON_SCOPE } from "../../shared/beacon-scope"
import { BEACON_DOWNLOAD_PAGE, buildBeaconPairLink } from "../../shared/beacon-pair-link"
import { domAdapter } from "../adapters/dom.adapter"
import type { BeaconConfig } from "../../shared/beacon-config"
import type { BeaconStatusRow } from "../../shared/beacon-status"
import { useBeaconsSectionStore } from "../stores/beaconsSectionStore"
import { useBeaconsStore } from "../stores/beaconsStore"
import { BeaconsSection, BeaconsSettingsBranch, type BeaconsSectionHandlers } from "./BeaconsSection"

const ROW: BeaconStatusRow = {
  id: "b1",
  label: "Work laptop",
  os: "darwin",
  enabled: true,
  online: true,
  lastSeenAt: Date.now() - 5_000,
  beaconVersion: "1.2.3",
  canSelfUpdate: true,
  update: null,
}

const CONFIG: BeaconConfig = {
  id: "b1",
  label: "Work laptop",
  publicKey: "pk",
  os: "darwin",
  scope: { ...DEFAULT_BEACON_SCOPE, readRoots: ["/Users/me/projects"] },
  enabled: true,
  createdAt: "",
  updatedAt: "",
}

const HANDLERS: BeaconsSectionHandlers = {
  onMint: async () => ({ ok: true, code: "123456", expiresAt: Date.now() + 600_000 }),
  onSetEnabled: async () => {},
  onSetScope: async () => {},
  onDelete: async () => {},
  onUpdate: async () => ({ ok: true }),
}

afterEach(() => {
  useBeaconsStore.getState().setRows([])
  useBeaconsSectionStore.setState({ pairing: null, expandedId: null, updateErrors: {} })
})

test("the settings branch renders live rows from the store without a render loop", async () => {
  useBeaconsStore.getState().setRows([ROW])
  const result = await renderForLoopCheck(
    <BeaconsSettingsBranch
      state={{
        handleWriteAppSettings: async () => {},
        handleMintBeaconPairingCode: HANDLERS.onMint,
        handleUpdateBeacon: HANDLERS.onUpdate,
      }}
    />,
  )
  expect(result.thrown).toBeNull()
  expect(result.loopWarnings).toEqual([])
  expect(document.body.textContent).toContain("Work laptop")
  expect(document.body.textContent).toContain("Online")
  await result.cleanup()
})

test("a minted code and an open scope editor render without a render loop", async () => {
  useBeaconsSectionStore.setState({
    pairing: { ok: true, code: "123456", expiresAt: Date.now() + 600_000 },
    expandedId: "b1",
  })
  const result = await renderForLoopCheck(<BeaconsSection rows={[ROW]} configs={[CONFIG]} handlers={HANDLERS} />)
  expect(result.thrown).toBeNull()
  expect(result.loopWarnings).toEqual([])
  expect(document.body.textContent).toContain("kanna-beacon pair")
  expect(document.body.textContent).toContain("/Users/me/projects")
  await result.cleanup()
})

test("a minted code offers a link that opens Kanna Beacon with the address and code filled in", async () => {
  useBeaconsSectionStore.setState({ pairing: { ok: true, code: "ABCD2345", expiresAt: Date.now() + 600_000 } })
  const result = await renderForLoopCheck(<BeaconsSection rows={[]} configs={[]} handlers={HANDLERS} />)
  const open = Array.from(document.querySelectorAll("a")).find((anchor) => anchor.textContent?.includes("Open in Kanna Beacon"))
  expect(open?.getAttribute("href")).toBe(buildBeaconPairLink({ kannaUrl: domAdapter.getOrigin(), code: "ABCD2345" }))
  const download = Array.from(document.querySelectorAll("a")).find((anchor) => anchor.getAttribute("href") === BEACON_DOWNLOAD_PAGE)
  expect(download).toBeDefined()
  await result.cleanup()
})

test("copying the pairing command turns the button into a Copied tick until the feedback window ends", async () => {
  useBeaconsSectionStore.setState({ pairing: { ok: true, code: "ABCD2345", expiresAt: Date.now() + 600_000 } })
  const clipboard = makeFakeClipboardPort()
  const timer = makeFakeTimerPort()
  const result = await renderForLoopCheck(
    <BeaconsSection rows={[]} configs={[]} handlers={HANDLERS} clipboard={clipboard} timer={timer} />,
  )
  const copyButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Copy pairing command"]')
  const copiedButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Copied"]')

  await act(async () => {
    copyButton()?.click()
  })
  expect(clipboard.clipboard).toBe(`kanna-beacon pair ${domAdapter.getOrigin()} ABCD2345`)
  expect(copiedButton()).not.toBeNull()

  await act(async () => {
    timer.flushTimeouts()
  })
  expect(copiedButton()).toBeNull()
  expect(copyButton()).not.toBeNull()
  await result.cleanup()
})

test("a refused mint shows its error and an empty list shows the empty state", async () => {
  useBeaconsSectionStore.setState({ pairing: { ok: false, error: "Set a Kanna password first" } })
  const result = await renderForLoopCheck(<BeaconsSection rows={[]} configs={[]} handlers={HANDLERS} />)
  expect(result.loopWarnings).toEqual([])
  expect(document.body.textContent).toContain("Set a Kanna password first")
  expect(document.body.textContent).toContain("No machines paired yet")
  await result.cleanup()
})

test("a beacon behind the server shows the update badge and an up-to-date one does not", async () => {
  const behind = await renderForLoopCheck(
    <BeaconsSection rows={[ROW]} configs={[CONFIG]} handlers={HANDLERS} serverVersion="1.3.0" />,
  )
  expect(behind.loopWarnings).toEqual([])
  expect(document.body.textContent).toContain("Update available")
  await behind.cleanup()

  const current = await renderForLoopCheck(
    <BeaconsSection rows={[ROW]} configs={[CONFIG]} handlers={HANDLERS} serverVersion="1.2.3" />,
  )
  expect(document.body.textContent).not.toContain("Update available")
  await current.cleanup()
})

function updateNowButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label="Update Work laptop now"]')
}

test("an online beacon that can update itself offers Update now, which asks the server once for that beacon", async () => {
  const requested: string[] = []
  const handlers: BeaconsSectionHandlers = {
    ...HANDLERS,
    onUpdate: async (id) => {
      requested.push(id)
      return { ok: true }
    },
  }
  const result = await renderForLoopCheck(
    <BeaconsSection rows={[ROW]} configs={[CONFIG]} handlers={handlers} serverVersion="1.3.0" />,
  )
  expect(result.loopWarnings).toEqual([])
  await act(async () => {
    updateNowButton()?.click()
  })
  expect(requested).toEqual(["b1"])
  expect(document.querySelector('[role="alert"]')).toBeNull()
  await result.cleanup()
})

test("a refused update shows the server's reason on the row", async () => {
  const handlers: BeaconsSectionHandlers = {
    ...HANDLERS,
    onUpdate: async () => ({ ok: false, error: "this beacon is offline" }),
  }
  const result = await renderForLoopCheck(
    <BeaconsSection rows={[ROW]} configs={[CONFIG]} handlers={handlers} serverVersion="1.3.0" />,
  )
  await act(async () => {
    updateNowButton()?.click()
  })
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("this beacon is offline")
  await result.cleanup()
})

test("Update now is not offered to an up-to-date, offline, or mid-update beacon", async () => {
  const cases: { row: BeaconStatusRow; serverVersion: string }[] = [
    { row: ROW, serverVersion: "1.2.3" },
    { row: { ...ROW, online: false }, serverVersion: "1.3.0" },
    { row: { ...ROW, update: { state: "downloading", version: "1.3.0" } }, serverVersion: "1.3.0" },
  ]
  for (const { row, serverVersion } of cases) {
    const result = await renderForLoopCheck(
      <BeaconsSection rows={[row]} configs={[CONFIG]} handlers={HANDLERS} serverVersion={serverVersion} />,
    )
    expect(updateNowButton()).toBeNull()
    await result.cleanup()
  }
})

test("the beacon's live update progress and a failure reason are shown beside its version", async () => {
  const progress = await renderForLoopCheck(
    <BeaconsSection
      rows={[{ ...ROW, update: { state: "downloading", version: "1.3.0" } }]}
      configs={[CONFIG]}
      handlers={HANDLERS}
      serverVersion="1.3.0"
    />,
  )
  expect(document.body.textContent).toContain("Downloading 1.3.0…")
  await progress.cleanup()

  const failed = await renderForLoopCheck(
    <BeaconsSection
      rows={[{ ...ROW, update: { state: "failed", version: "1.3.0", message: "checksum mismatch" } }]}
      configs={[CONFIG]}
      handlers={HANDLERS}
      serverVersion="1.3.0"
    />,
  )
  expect(document.body.textContent).toContain("Update failed: checksum mismatch")
  expect(updateNowButton()).not.toBeNull()
  await failed.cleanup()
})

test("a beacon too old to update itself links its update badge to the download page instead of offering Update now", async () => {
  const result = await renderForLoopCheck(
    <BeaconsSection rows={[{ ...ROW, canSelfUpdate: false }]} configs={[CONFIG]} handlers={HANDLERS} serverVersion="1.3.0" />,
  )
  expect(updateNowButton()).toBeNull()
  const badge = Array.from(document.querySelectorAll("a")).find((anchor) => anchor.textContent === "Update available")
  expect(badge?.getAttribute("href")).toBe(BEACON_DOWNLOAD_PAGE)
  await result.cleanup()
})
