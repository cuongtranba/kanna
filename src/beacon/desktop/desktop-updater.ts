import { BEACON_DOWNLOAD_PAGE } from "../../shared/beacon-pair-link"
import { errorMessage } from "../../shared/errors"
import type { BeaconUpdateHooks, BeaconUpdater, BeaconUpdateResult } from "../ports"

export interface ElectrobunUpdateInfo {
  version: string
  updateAvailable: boolean
  updateReady: boolean
  error: string
}

export interface ElectrobunLocalInfo {
  channel: string
  baseUrl: string
}

export interface ElectrobunUpdaterPort {
  localInfo(): Promise<ElectrobunLocalInfo>
  checkForUpdate(): Promise<ElectrobunUpdateInfo>
  downloadUpdate(): Promise<void>
  updateInfo(): ElectrobunUpdateInfo
  applyUpdate(): Promise<void>
}

export interface DesktopSelfUpdate {
  updater: BeaconUpdater
  restart(): Promise<BeaconUpdateResult>
}

const MANAGED_DIRECTORY_ERROR = "outside its managed update directory"

export const REINSTALL_TO_UPDATE = `Kanna Beacon is not installed where its installer puts it, so it cannot update itself. Reinstall Kanna Beacon with the installer from ${BEACON_DOWNLOAD_PAGE} to enable updates`

export const DEV_BUILD_CANNOT_UPDATE = "this is a development build of Kanna Beacon, and development builds do not update themselves"

export const NO_UPDATE_ADDRESS = `this copy of Kanna Beacon was built without an update address; install the new version once from ${BEACON_DOWNLOAD_PAGE}`

export function latestReleaseMismatch(latest: string, kanna: string): string {
  return `the latest release is ${latest}, but Kanna is ${kanna}; Kanna Beacon updates only to the latest release, and only when it matches Kanna`
}

export function describeElectrobunUpdateError(raw: string): string {
  if (raw.includes(MANAGED_DIRECTORY_ERROR)) return REINSTALL_TO_UPDATE
  if (/\bHTTP 404\b/.test(raw)) {
    return `the latest release has no Kanna Beacon update for this computer yet (${raw}); a new release can take a few minutes to upload, so try again shortly`
  }
  return raw
}

function failure(error: string): BeaconUpdateResult {
  return { ok: false, error }
}

export function createDesktopSelfUpdate(port: ElectrobunUpdaterPort): DesktopSelfUpdate {
  let prepared: string | null = null
  let failedRestart: { version: string; error: string } | null = null

  async function prepare(version: string, hooks: BeaconUpdateHooks): Promise<BeaconUpdateResult> {
    const local = await port.localInfo()
    if (local.channel === "dev") return failure(DEV_BUILD_CANNOT_UPDATE)
    if (local.baseUrl.trim() === "") return failure(NO_UPDATE_ADDRESS)
    hooks.onStep("checking")
    const checked = await port.checkForUpdate()
    if (checked.error !== "") return failure(describeElectrobunUpdateError(checked.error))
    if (checked.version !== version) return failure(latestReleaseMismatch(checked.version, version))
    if (!checked.updateAvailable) return failure(`Electrobun reports that version ${version} is already installed`)
    hooks.onStep("downloading")
    await port.downloadUpdate()
    const downloaded = port.updateInfo()
    if (downloaded.error !== "") return failure(describeElectrobunUpdateError(downloaded.error))
    if (!downloaded.updateReady || downloaded.version !== version) {
      return failure(`the downloaded update is ${downloaded.version || "missing"}, not ${version}`)
    }
    hooks.onStep("installing")
    await hooks.beforeSwap()
    prepared = version
    return { ok: true }
  }

  const updater: BeaconUpdater = {
    async install(version, hooks) {
      prepared = null
      const earlier = failedRestart
      failedRestart = null
      if (earlier !== null && earlier.version === version) {
        return failure(`restarting into ${version} failed: ${earlier.error}`)
      }
      try {
        return await prepare(version, hooks)
      } catch (error) {
        return failure(describeElectrobunUpdateError(errorMessage(error)))
      }
    },
  }

  async function restart(): Promise<BeaconUpdateResult> {
    const version = prepared
    prepared = null
    if (version === null) return failure("no update has been downloaded")
    let error: string
    try {
      await port.applyUpdate()
      error = port.updateInfo().error
    } catch (thrown) {
      error = errorMessage(thrown)
    }
    if (error === "") return { ok: true }
    const described = describeElectrobunUpdateError(error)
    failedRestart = { version, error: described }
    return failure(described)
  }

  return { updater, restart }
}
