import { afterEach, expect, test } from "bun:test"
import "../lib/testing/setupHappyDom"
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
}

afterEach(() => {
  useBeaconsStore.getState().setRows([])
  useBeaconsSectionStore.setState({ pairing: null, expandedId: null })
})

test("the settings branch renders live rows from the store without a render loop", async () => {
  useBeaconsStore.getState().setRows([ROW])
  const result = await renderForLoopCheck(
    <BeaconsSettingsBranch
      state={{ handleWriteAppSettings: async () => {}, handleMintBeaconPairingCode: HANDLERS.onMint }}
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
