import { useCallback, type ChangeEvent, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { stateMarkKind, stateMarkStrokes } from "../../../client/lib/stateMark"
import type { StatusTone } from "../../../client/lib/statusLabel"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../../client/stores/pendingActionsStore"
import type { DesktopRequestName, DesktopView } from "../desktop-types"
import type { DesktopLocale, DesktopStrings } from "../strings"
import { type DesktopBridge } from "./bridge"
import { splitFolderPath } from "./present"

export interface Shared {
  bridge: DesktopBridge
  strings: DesktopStrings
  locale: DesktopLocale
}

export function desktopActionKey(name: DesktopRequestName): string {
  return pendingActionKey(`beacon.${name}`)
}

export const KEY = {
  getView: desktopActionKey("getView"),
  submit: desktopActionKey("submitPairingInput"),
  confirm: desktopActionKey("confirmPairing"),
  cancel: desktopActionKey("cancelPairing"),
  openGrant: desktopActionKey("openGrant"),
  closeGrant: desktopActionKey("closeGrant"),
  applyGrant: desktopActionKey("applyGrant"),
  pickFolders: desktopActionKey("pickFolders"),
  paused: desktopActionKey("setPaused"),
  login: desktopActionKey("setLaunchAtLogin"),
  unpair: desktopActionKey("unpair"),
  dismiss: desktopActionKey("dismissNotice"),
  external: desktopActionKey("openExternal"),
}

export function useLaunchAtLoginBusy(view: DesktopView): boolean {
  const pending = usePendingAction(KEY.login)
  return pending || view.busy.launchAtLogin
}

export function useUnpairBusy(view: DesktopView): boolean {
  const pending = usePendingAction(KEY.unpair)
  return pending || view.busy.unpairing
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


export function LaunchAtLoginToggle({ view, bridge, label }: { view: DesktopView; bridge: DesktopBridge; label: string }) {
  const busy = useLaunchAtLoginBusy(view)
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const enabled = event.target.checked
      runPendingAction(KEY.login, () => bridge.request("setLaunchAtLogin", { enabled }))
    },
    [bridge],
  )
  return (
    <label className="bd-check">
      <input type="checkbox" checked={view.prefs.launchAtLogin} onChange={onChange} disabled={busy} />
      <span>{label}</span>
      {busy ? <Spinner /> : null}
    </label>
  )
}

export function FolderLabel({ root }: { root: string }) {
  const { name, parent } = splitFolderPath(root)
  return (
    <>
      <span className="bd-folder-name">{name}</span>
      {parent !== "" && (
        <span className="bd-folder-parent">
          <bdi>{parent}</bdi>
        </span>
      )}
    </>
  )
}
