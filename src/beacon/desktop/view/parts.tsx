import { type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { stateMarkKind, stateMarkStrokes } from "../../../client/lib/stateMark"
import type { StatusTone } from "../../../client/lib/statusLabel"
import { pendingActionKey } from "../../../client/stores/pendingActionsStore"
import type { DesktopLocale, DesktopStrings } from "../strings"
import { type DesktopBridge } from "./bridge"

export interface Shared {
  bridge: DesktopBridge
  strings: DesktopStrings
  locale: DesktopLocale
}

export const KEY = {
  submit: pendingActionKey("beacon.submitPairingInput"),
  confirm: pendingActionKey("beacon.confirmPairing"),
  cancel: pendingActionKey("beacon.cancelPairing"),
  openGrant: pendingActionKey("beacon.openGrant"),
  closeGrant: pendingActionKey("beacon.closeGrant"),
  applyGrant: pendingActionKey("beacon.applyGrant"),
  pickFolders: pendingActionKey("beacon.pickFolders"),
  paused: pendingActionKey("beacon.setPaused"),
  login: pendingActionKey("beacon.setLaunchAtLogin"),
  unpair: pendingActionKey("beacon.unpair"),
  dismiss: pendingActionKey("beacon.dismissNotice"),
  external: pendingActionKey("beacon.openExternal"),
}

export function cx(...names: ReadonlyArray<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ")
}

export function unbreakable(name: string): string {
  return name.replaceAll("-", "\u2011")
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function StateMark({ tone }: { tone: StatusTone }) {
  const strokes = stateMarkStrokes(stateMarkKind(tone))
  return (
    <svg aria-hidden viewBox="0 0 9 13" className={cx("bd-mark", `bd-tone-${tone}`)}>
      {strokes.map((stroke) => (
        <line
          key={`${stroke.x1}-${stroke.y1}-${stroke.x2}-${stroke.y2}`}
          x1={stroke.x1}
          y1={stroke.y1}
          x2={stroke.x2}
          y2={stroke.y2}
          stroke="currentColor"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  )
}

export function MarkLabel({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={cx("bd-mark-label", `bd-tone-${tone}`)}>
      <StateMark tone={tone} />
      {label}
    </span>
  )
}

export function Spinner() {
  return <Loader2 className="bd-spinner" aria-hidden />
}

export function ActionButton({
  pending,
  variant = "secondary",
  children,
  onClick,
  disabled,
  type = "button",
  label,
  autoFocus,
}: {
  pending?: boolean
  variant?: "primary" | "secondary" | "ghost" | "destructive"
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: "button" | "submit"
  label?: string
  autoFocus?: boolean
}) {
  return (
    <button
      type={type}
      className={cx("bd-button", `bd-button-${variant}`)}
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      aria-label={label}
      autoFocus={autoFocus}
    >
      {pending ? <Spinner /> : null}
      {children}
    </button>
  )
}

