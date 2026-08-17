import type { ChatDiffSnapshot } from "../../shared/types"
import type { StoragePort } from "../ports/storagePort"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import type { SocketStatus } from "./socket"
import type { UpdateSnapshot } from "../../shared/types"

// ---------------------------------------------------------------------------
// Diff preservation (extracted from useAppGlobalState for testability)
// ---------------------------------------------------------------------------

export function sameDiffs(
  left: ChatDiffSnapshot | null | undefined,
  right: ChatDiffSnapshot | null | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  if (left.status !== right.status) return false
  if (left.branchName !== right.branchName) return false
  if (left.defaultBranchName !== right.defaultBranchName) return false
  if (left.hasOriginRemote !== right.hasOriginRemote) return false
  if (left.originRepoSlug !== right.originRepoSlug) return false
  if (left.hasUpstream !== right.hasUpstream) return false
  if (left.aheadCount !== right.aheadCount) return false
  if (left.behindCount !== right.behindCount) return false
  if (left.lastFetchedAt !== right.lastFetchedAt) return false
  const leftHistory = left.branchHistory?.entries ?? []
  const rightHistory = right.branchHistory?.entries ?? []
  if (leftHistory.length !== rightHistory.length) return false
  const sameBranchHistory = leftHistory.every((entry, index) => {
    const other = rightHistory[index]
    return Boolean(other)
      && entry.sha === other.sha
      && entry.summary === other.summary
      && entry.description === other.description
      && entry.authorName === other.authorName
      && entry.authoredAt === other.authoredAt
      && entry.githubUrl === other.githubUrl
      && entry.tags.length === other.tags.length
      && entry.tags.every((tag, tagIndex) => tag === other.tags[tagIndex])
  })
  if (!sameBranchHistory) return false
  if (left.files.length !== right.files.length) return false
  return left.files.every((file, index) => {
    const other = right.files[index]
    return Boolean(other)
      && file.path === other.path
      && file.changeType === other.changeType
      && file.isUntracked === other.isUntracked
      && file.additions === other.additions
      && file.deletions === other.deletions
      && file.patchDigest === other.patchDigest
      && file.mimeType === other.mimeType
      && file.size === other.size
  })
}

export function shouldPreserveExistingProjectDiffs(
  current: ChatDiffSnapshot | null | undefined,
  next: ChatDiffSnapshot | null | undefined,
): boolean {
  return Boolean(
    current
    && current.status !== "unknown"
    && next
    && next.status === "unknown"
    && next.files.length === 0,
  )
}

// ---------------------------------------------------------------------------
// UpdateRestartRuntime — explicit state machine for update/restart lifecycle
//
// Replaces three tangled useEffects in useAppGlobalState. The pure transition
// function is testable without React or side effects.
//
// State diagram:
//   idle ──(reload_requested)──► awaiting_disconnect
//   awaiting_disconnect ──(disconnected)──► awaiting_server_ready
//   awaiting_server_ready ──(server_ready)──► idle  [+ dom.reload()]
//   any ──(aborted)──► idle
// ---------------------------------------------------------------------------

export type UpdateRestartPhase =
  | "idle"
  | "awaiting_disconnect"
  | "awaiting_server_ready"

export interface UpdateRestartSnapshot {
  phase: UpdateRestartPhase
  activity: { active: boolean; label: string }
}

export type UpdateRestartIntent =
  | { kind: "reload_requested"; reloadRequestedAt: number; lastHandled: string | null }
  | { kind: "update_initiated" }
  | { kind: "update_status_changed"; updateStatus: UpdateSnapshot["status"] | null | undefined }
  | { kind: "connection_status_changed"; connectionStatus: SocketStatus }
  | { kind: "server_ready" }
  | { kind: "aborted" }

const STORAGE_PHASE_KEY = "kanna:ui-update-restart"
const STORAGE_LAST_RELOAD_KEY = "kanna:last-update-reload-request"

function deriveActivity(phase: UpdateRestartPhase, updateStatus: UpdateSnapshot["status"] | null | undefined): { active: boolean; label: string } {
  if (updateStatus === "updating" || updateStatus === "restart_pending") {
    return { active: true, label: "Installing update" }
  }
  if (phase === "awaiting_disconnect" || phase === "awaiting_server_ready") {
    return { active: true, label: "Re-deploying Kanna" }
  }
  return { active: false, label: "" }
}

export function transitionUpdateRestart(
  phase: UpdateRestartPhase,
  intent: UpdateRestartIntent,
): UpdateRestartPhase {
  switch (intent.kind) {
    case "reload_requested": {
      if (String(intent.reloadRequestedAt) === intent.lastHandled) return phase
      return "awaiting_disconnect"
    }
    case "update_initiated": {
      return "awaiting_disconnect"
    }
    case "connection_status_changed": {
      if (intent.connectionStatus === "disconnected" && phase === "awaiting_disconnect") {
        return "awaiting_server_ready"
      }
      return phase
    }
    case "server_ready": {
      return "idle"
    }
    case "aborted": {
      return "idle"
    }
    case "update_status_changed":
      return phase
  }
}

export interface UpdateRestartRuntimeDeps {
  storage: StoragePort
  dom: DomPort
  timer: TimerPort
  onSnapshot: (snapshot: UpdateRestartSnapshot) => void
}

export class UpdateRestartRuntime {
  private phase: UpdateRestartPhase
  private updateStatus: UpdateSnapshot["status"] | null | undefined = null
  private pollCancelled = false
  private pollTimeoutId: number | null = null
  private isServerReady: () => Promise<boolean>

  constructor(
    private readonly deps: UpdateRestartRuntimeDeps,
    opts: { isServerReady: () => Promise<boolean> },
  ) {
    this.isServerReady = opts.isServerReady
    const persisted = deps.storage.getItem(STORAGE_PHASE_KEY)
    this.phase = persisted === "awaiting_disconnect" || persisted === "awaiting_server_ready"
      ? persisted
      : "idle"
    if (this.phase === "awaiting_server_ready") {
      this.startPolling()
    }
  }

  getSnapshot(): UpdateRestartSnapshot {
    return { phase: this.phase, activity: deriveActivity(this.phase, this.updateStatus) }
  }

  private emit(): void {
    this.deps.onSnapshot(this.getSnapshot())
  }

  private setPhase(next: UpdateRestartPhase): void {
    if (next === this.phase) return
    this.phase = next
    if (next === "idle") {
      this.deps.storage.removeItem(STORAGE_PHASE_KEY)
    } else {
      this.deps.storage.setItem(STORAGE_PHASE_KEY, next)
    }
    this.emit()
  }

  dispatch(intent: UpdateRestartIntent): void {
    if (intent.kind === "update_status_changed") {
      const prev = this.updateStatus
      this.updateStatus = intent.updateStatus
      if (prev !== this.updateStatus) this.emit()
      return
    }

    const next = transitionUpdateRestart(this.phase, intent)

    if (intent.kind === "reload_requested" && next === "awaiting_disconnect") {
      this.deps.storage.setItem(STORAGE_LAST_RELOAD_KEY, String(intent.reloadRequestedAt))
    }

    this.setPhase(next)

    if (next === "awaiting_server_ready") {
      this.startPolling()
    }
  }

  private startPolling(): void {
    this.pollCancelled = false
    void this.poll()
  }

  private async poll(): Promise<void> {
    try {
      if (await this.isServerReady()) {
        if (this.pollCancelled) return
        this.setPhase("idle")
        this.deps.dom.reload()
        return
      }
    } catch {
      // Server not yet reachable — keep polling
    }
    if (this.pollCancelled) return
    this.pollTimeoutId = this.deps.timer.setTimeout(() => {
      void this.poll()
    }, 500)
  }

  close(): void {
    this.pollCancelled = true
    if (this.pollTimeoutId !== null) {
      this.deps.timer.clearTimeout(this.pollTimeoutId)
      this.pollTimeoutId = null
    }
  }

  static getLastHandledReloadRequest(storage: StoragePort): string | null {
    return storage.getItem(STORAGE_LAST_RELOAD_KEY)
  }
}
