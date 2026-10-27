import { useCallback, type ChangeEvent } from "react"
import { FolderPlus, X } from "lucide-react"
import { runPendingAction, usePendingAction } from "../../../client/stores/pendingActionsStore"
import type { DesktopGrantError, DesktopScreen, DesktopView } from "../desktop-types"
import type { DesktopStrings } from "../strings"
import { NO_PARAMS } from "./bridge"
import { splitFolderPath } from "./present"
import { draftNeedsConsent, selectGrantDraft, useDesktopViewStore } from "./view-store"
import { ActionButton, FolderLabel, KEY, LaunchAtLoginToggle, type Shared } from "./parts"

function grantErrorText(error: DesktopGrantError, strings: DesktopStrings): string {
  switch (error) {
    case "offline":
      return strings.grant.errors.offline
    case "rejected":
      return strings.grant.errors.rejected
    case "needs-newer-kanna":
      return strings.grant.errors.needsNewerKanna
  }
}

export function GrantScreen({
  screen,
  view,
  bridge,
  strings,
}: Shared & { screen: Extract<DesktopScreen, { kind: "grant" }>; view: DesktopView }) {
  const draft = useDesktopViewStore(selectGrantDraft)
  const addFolders = useDesktopViewStore((state) => state.addFolders)
  const removeFolder = useDesktopViewStore((state) => state.removeFolder)
  const setExec = useDesktopViewStore((state) => state.setExec)
  const setAskFirst = useDesktopViewStore((state) => state.setAskFirst)
  const setConsented = useDesktopViewStore((state) => state.setConsented)
  const clearDraft = useDesktopViewStore((state) => state.clearDraft)
  const picking = usePendingAction(KEY.pickFolders)
  const online = view.runner?.status.phase === "online"
  const osName = strings.osName[view.os]

  const onPick = useCallback(() => {
    runPendingAction(KEY.pickFolders, async () => {
      const { paths } = await bridge.request("pickFolders", NO_PARAMS)
      if (paths.length > 0) addFolders(paths)
    })
  }, [addFolders, bridge])
  const onExec = useCallback((event: ChangeEvent<HTMLInputElement>) => setExec(event.target.checked), [setExec])
  const onAskFirst = useCallback((event: ChangeEvent<HTMLInputElement>) => setAskFirst(event.target.checked), [setAskFirst])
  const onConsent = useCallback((event: ChangeEvent<HTMLInputElement>) => setConsented(event.target.checked), [setConsented])
  const onSave = useCallback(() => {
    runPendingAction(KEY.applyGrant, () =>
      bridge.request("applyGrant", {
        grant: { readRoots: draft.readRoots, exec: draft.exec, autoRunScripts: !draft.askFirst },
      }),
    )
  }, [bridge, draft])
  const onClose = useCallback(() => {
    clearDraft()
    runPendingAction(KEY.closeGrant, () => bridge.request("closeGrant", NO_PARAMS))
  }, [bridge, clearDraft])

  return (
    <main className="bd-screen bd-grant-screen">
      <h1 className="bd-headline">{screen.firstRun ? strings.grant.titleFirstRun : strings.grant.titleEdit}</h1>
      <section className="bd-group" aria-labelledby="bd-folders-heading">
        <h2 id="bd-folders-heading" className="bd-title">
          {strings.grant.foldersHeading}
        </h2>
        <p className="bd-hint">{strings.grant.foldersHint}</p>
        {draft.readRoots.length === 0 ? (
          <p className="bd-empty">{strings.grant.foldersEmpty}</p>
        ) : (
          <ul className="bd-folders">
            {draft.readRoots.map((root) => (
              <FolderRow key={root} root={root} label={strings.grant.removeFolder(splitFolderPath(root).name)} onRemove={removeFolder} />
            ))}
          </ul>
        )}
        <div>
          <ActionButton pending={picking} onClick={onPick}>
            <FolderPlus className="bd-icon" aria-hidden />
            {strings.grant.addFolder}
          </ActionButton>
        </div>
      </section>
      <section className="bd-group" aria-labelledby="bd-commands-heading">
        <h2 id="bd-commands-heading" className="bd-title">
          {strings.grant.commandsHeading}
        </h2>
        <Toggle checked={draft.exec} onChange={onExec} label={strings.grant.allowCommands} hint={strings.grant.allowCommandsHint} />
        <Toggle checked={draft.askFirst} onChange={onAskFirst} label={strings.grant.askFirst} hint={strings.grant.askFirstHint} />
        {!draft.askFirst && (
          <div className="bd-consent" role="group" aria-labelledby="bd-consent-title">
            <h3 id="bd-consent-title" className="bd-consent-title">
              {strings.grant.consentTitle}
            </h3>
            <p className="bd-body">{strings.grant.consentBody}</p>
            <label className="bd-check">
              <input type="checkbox" checked={draft.consented} onChange={onConsent} />
              <span>{strings.grant.consentAgree}</span>
            </label>
          </div>
        )}
      </section>
      {screen.firstRun && (
        <section className="bd-group">
          <LaunchAtLoginToggle view={view} bridge={bridge} label={strings.grant.launchAtLogin(osName)} />
        </section>
      )}
      {screen.saveError !== null && (
        <p className="bd-error" role="alert">
          {grantErrorText(screen.saveError, strings)}
        </p>
      )}
      {!online && <p className="bd-hint">{strings.grant.waitingOnline}</p>}
      <div className="bd-row-end bd-sticky-actions">
        <ActionButton variant="ghost" onClick={onClose} disabled={screen.saving}>
          {screen.firstRun ? strings.grant.skip : strings.grant.cancel}
        </ActionButton>
        <ActionButton
          variant="primary"
          pending={screen.saving}
          onClick={onSave}
          disabled={!online || draftNeedsConsent(draft)}
        >
          {screen.saving ? strings.grant.saving : strings.grant.save}
        </ActionButton>
      </div>
    </main>
  )
}

function FolderRow({
  root,
  label,
  onRemove,
}: {
  root: string
  label: string
  onRemove: (path: string) => void
}) {
  const remove = useCallback(() => onRemove(root), [onRemove, root])
  return (
    <li className="bd-folder">
      <span className="bd-folder-text">
        <FolderLabel root={root} />
      </span>
      <button type="button" className="bd-icon-button" onClick={remove} aria-label={label}>
        <X className="bd-icon" aria-hidden />
      </button>
    </li>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  label: string
  hint: string
}) {
  return (
    <label className="bd-check bd-toggle">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="bd-toggle-text">
        <span className="bd-toggle-label">{label}</span>
        <span className="bd-hint">{hint}</span>
      </span>
    </label>
  )
}

