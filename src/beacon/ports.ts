import type { BeaconFrame, BeaconOs } from "../shared/beacon-protocol"
import type { BeaconTransferResult } from "../shared/beacon-transfer"
import type { JsonValue } from "../shared/json"

export class BeaconScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BeaconScopeError"
  }
}

export interface BeaconTransport {
  send(frame: BeaconFrame): void
  onFrame(callback: (frame: BeaconFrame) => void): void
  onClose(callback: () => void): void
  close(): void
}

export interface BeaconKeyStore {
  publicKeySpkiBase64(): string
  sign(nonce: string): string
}

export interface BeaconRequestSink {
  stdout(chunk: string): void
  stderr(chunk: string): void
}

export interface BeaconFsPort {
  read(path: string, offset: number, limit: number): Promise<JsonValue>
  stat(path: string): Promise<JsonValue>
  glob(path: string): Promise<JsonValue>
  grep(root: string, pattern: string): Promise<JsonValue>
  fetchChunk(path: string, from: number): Promise<JsonValue>
}

export interface BeaconTransferPort {
  upload(request: { path: string; ticket: string }): Promise<BeaconTransferResult>
  download(request: {
    path: string
    ticket: string
    size: number
    sha256: string
    overwrite: boolean
  }): Promise<BeaconTransferResult>
}

export interface BeaconExecLimits {
  timeoutMs: number
  outputByteCap: number
}

export interface BeaconShellPort {
  exec(
    args: { cmd: string; cmdArgs: readonly string[]; cwd?: string },
    sink: BeaconRequestSink,
    limits: BeaconExecLimits,
  ): Promise<number>
  script(body: string, sink: BeaconRequestSink, limits: BeaconExecLimits): Promise<number>
}

export interface BeaconPairingRequest {
  code: string
  publicKey: string
  label: string
  os: BeaconOs
}

export type BeaconPairingResult = { ok: true; beaconId: string } | { ok: false; error: string; status: number | null }

export interface BeaconPairClient {
  pair(kannaUrl: string, request: BeaconPairingRequest): Promise<BeaconPairingResult>
}

export type BeaconUpdateStep = "checking" | "downloading" | "installing"

export type BeaconUpdateResult = { ok: true } | { ok: false; error: string }

export interface BeaconUpdateHooks {
  onStep(step: BeaconUpdateStep): void
  beforeSwap(): Promise<void>
}

export interface BeaconUpdater {
  install(version: string, hooks: BeaconUpdateHooks): Promise<BeaconUpdateResult>
}

export interface BeaconState {
  kannaUrl: string
  beaconId: string
}

export interface BeaconStateStore {
  load(): Promise<BeaconState | null>
  save(state: BeaconState): Promise<void>
  clear(): Promise<void>
}
