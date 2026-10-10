import { describe, expect, test } from "bun:test"
import type { BeaconUpdateHooks, BeaconUpdateStep } from "../ports"
import {
  createDesktopSelfUpdate,
  DEV_BUILD_CANNOT_UPDATE,
  latestReleaseMismatch,
  NO_UPDATE_ADDRESS,
  REINSTALL_TO_UPDATE,
  type ElectrobunLocalInfo,
  type ElectrobunUpdateInfo,
  type ElectrobunUpdaterPort,
} from "./desktop-updater"

const STABLE: ElectrobunLocalInfo = { channel: "stable", baseUrl: "https://github.com/cuongtranba/kanna/releases/latest/download" }
const NOTHING: ElectrobunUpdateInfo = { version: "", updateAvailable: false, updateReady: false, error: "" }

function createFakeElectrobun(options: {
  local?: ElectrobunLocalInfo
  latest: string
  checkError?: string
  downloadThrows?: string
  applyError?: string
}) {
  const calls: string[] = []
  let info: ElectrobunUpdateInfo = NOTHING
  const port: ElectrobunUpdaterPort = {
    localInfo: async () => options.local ?? STABLE,
    checkForUpdate: async () => {
      calls.push("check")
      info =
        options.checkError === undefined
          ? { version: options.latest, updateAvailable: true, updateReady: false, error: "" }
          : { ...NOTHING, error: options.checkError }
      return info
    },
    downloadUpdate: async () => {
      calls.push("download")
      if (options.downloadThrows !== undefined) throw new Error(options.downloadThrows)
      info = { ...info, updateReady: true }
    },
    updateInfo: () => info,
    applyUpdate: async () => {
      calls.push("apply")
      if (options.applyError !== undefined) info = { ...info, error: options.applyError }
    },
  }
  return { port, calls }
}

function recordingHooks(calls: string[]): BeaconUpdateHooks & { steps: BeaconUpdateStep[] } {
  const steps: BeaconUpdateStep[] = []
  return {
    steps,
    onStep: (step) => void steps.push(step),
    beforeSwap: async () => void calls.push("beforeSwap"),
  }
}

describe("desktop self-update", () => {
  test("refuses to download when the latest release is not Kanna's version", async () => {
    const fake = createFakeElectrobun({ latest: "1.70.0" })
    const { updater } = createDesktopSelfUpdate(fake.port)
    const result = await updater.install("1.71.0", recordingHooks(fake.calls))
    expect(result).toEqual({ ok: false, error: latestReleaseMismatch("1.70.0", "1.71.0") })
    expect(fake.calls).toEqual(["check"])
  })

  test("downloads when the latest release is Kanna's version, quiesces, then applies only on restart", async () => {
    const fake = createFakeElectrobun({ latest: "1.71.0" })
    const selfUpdate = createDesktopSelfUpdate(fake.port)
    const hooks = recordingHooks(fake.calls)
    expect(await selfUpdate.updater.install("1.71.0", hooks)).toEqual({ ok: true })
    expect(hooks.steps).toEqual(["checking", "downloading", "installing"])
    expect(fake.calls).toEqual(["check", "download", "beforeSwap"])
    expect(await selfUpdate.restart()).toEqual({ ok: true })
    expect(fake.calls).toEqual(["check", "download", "beforeSwap", "apply"])
  })

  test("an install outside the managed directory asks for a reinstall", async () => {
    const fake = createFakeElectrobun({
      latest: "1.71.0",
      downloadThrows: "The running application is outside its managed update directory",
    })
    const { updater } = createDesktopSelfUpdate(fake.port)
    const result = await updater.install("1.71.0", recordingHooks(fake.calls))
    expect(result).toEqual({ ok: false, error: REINSTALL_TO_UPDATE })
    expect(fake.calls).not.toContain("beforeSwap")
  })

  test("a release whose desktop update is not uploaded yet says so", async () => {
    const fake = createFakeElectrobun({ latest: "1.71.0", checkError: "Failed to check for updates: HTTP 404" })
    const { updater } = createDesktopSelfUpdate(fake.port)
    const result = await updater.install("1.71.0", recordingHooks(fake.calls))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("try again shortly")
    expect(fake.calls).toEqual(["check"])
  })

  test("a development build and a build with no update address never check", async () => {
    const dev = createFakeElectrobun({ latest: "1.71.0", local: { ...STABLE, channel: "dev" } })
    expect(await createDesktopSelfUpdate(dev.port).updater.install("1.71.0", recordingHooks(dev.calls))).toEqual({
      ok: false,
      error: DEV_BUILD_CANNOT_UPDATE,
    })
    const blank = createFakeElectrobun({ latest: "1.71.0", local: { ...STABLE, baseUrl: "" } })
    expect(await createDesktopSelfUpdate(blank.port).updater.install("1.71.0", recordingHooks(blank.calls))).toEqual({
      ok: false,
      error: NO_UPDATE_ADDRESS,
    })
    expect([...dev.calls, ...blank.calls]).toEqual([])
  })

  test("restart without a downloaded update applies nothing", async () => {
    const fake = createFakeElectrobun({ latest: "1.71.0" })
    expect(await createDesktopSelfUpdate(fake.port).restart()).toEqual({ ok: false, error: "no update has been downloaded" })
    expect(fake.calls).toEqual([])
  })

  test("a failed restart is reported once by the next attempt, and the one after retries", async () => {
    const fake = createFakeElectrobun({ latest: "1.71.0", applyError: "Failed to start update helper: EACCES" })
    const selfUpdate = createDesktopSelfUpdate(fake.port)
    await selfUpdate.updater.install("1.71.0", recordingHooks(fake.calls))
    expect(await selfUpdate.restart()).toEqual({ ok: false, error: "Failed to start update helper: EACCES" })
    const reported = await selfUpdate.updater.install("1.71.0", recordingHooks(fake.calls))
    expect(reported).toEqual({ ok: false, error: "restarting into 1.71.0 failed: Failed to start update helper: EACCES" })
    expect(fake.calls.filter((call) => call === "check")).toHaveLength(1)
    expect(await selfUpdate.updater.install("1.71.0", recordingHooks(fake.calls))).toEqual({ ok: true })
    expect(fake.calls.filter((call) => call === "check")).toHaveLength(2)
  })
})
