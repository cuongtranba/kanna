import { TRANSFER_PART_SUFFIX } from "../shared/beacon-transfer"

export type TransferPathOutcome<TValue> = ({ ok: true } & TValue) | { ok: false; error: string }

export interface PullDestinationRequest {
  projectRoot: string
  dest: string | undefined
  beaconPath: string
  overwrite: boolean
}

export interface PullDestination {
  kannaPath: string
  workspacePath: string
}

export interface PushSource {
  kannaPath: string
  workspacePath: string
  size: number
}

export interface FileDigest {
  bytes: number
  sha256: string
}

export interface BeaconTransferFiles {
  resolvePullDestination(request: PullDestinationRequest): Promise<TransferPathOutcome<PullDestination>>
  resolvePushSource(projectRoot: string, source: string): Promise<TransferPathOutcome<PushSource>>
  hashFile(path: string): Promise<FileDigest>
  discardPart(kannaPath: string): Promise<void>
}

const DEFAULT_PULL_DIRECTORY = ".kanna/uploads"
const FALLBACK_FILE_NAME = "file"
const CONTROL_CHARACTERS = /[\u0000-\u001f]/g

export function partPathOf(kannaPath: string): string {
  return `${kannaPath}${TRANSFER_PART_SUFFIX}`
}

export function beaconFileName(beaconPath: string): string {
  const segments = beaconPath.split(/[\\/]/)
  const last = (segments[segments.length - 1] ?? "").replace(CONTROL_CHARACTERS, "_").trim()
  return last === "" || last === "." || last === ".." ? FALLBACK_FILE_NAME : last
}

export function defaultPullPath(beaconPath: string): string {
  return `${DEFAULT_PULL_DIRECTORY}/${beaconFileName(beaconPath)}`
}

export function numberedName(fileName: string, copy: number): string {
  const dot = fileName.lastIndexOf(".")
  if (dot <= 0) return `${fileName} (${String(copy)})`
  return `${fileName.slice(0, dot)} (${String(copy)})${fileName.slice(dot)}`
}
