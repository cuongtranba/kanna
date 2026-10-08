import { useCallback, useMemo, useRef, type ChangeEvent } from "react"
import { MoreHorizontal } from "lucide-react"
import { useNow } from "../../../client/hooks/useNow"
import { runPendingAction, usePendingAction } from "../../../client/stores/pendingActionsStore"
import type { BeaconActivity } from "../../activity"
import type { DesktopView } from "../desktop-types"
import type { DesktopLocale, DesktopStrings } from "../strings"
import { NO_PARAMS } from "./bridge"
import { formatClock, groupActivityByDay, presentGrant, presentOutcome, splitFolderPath } from "./present"
import { useDesktopViewStore } from "./view-store"
import { ActionButton, cx, hostOf, KEY, MarkLabel, Spinner, StateMark, type Shared } from "./parts"

export function HomeScreen({ view, bridge, strings, locale }: Shared & { view: DesktopView }) {
  const openPending = usePendingAction(KEY.openGrant)
  const onChange = useCallback(() => {
    runPendingAction(KEY.openGrant, () => bridge.request("openGrant", NO_PARAMS))
  }, [bridge])
  const scope = view.runner?.scope ?? null
  const grant = scope === null ? null : presentGrant(scope, strings)
  return (
    <>
      <main className="bd-screen bd-home">
        <section className="bd-grant" aria-labelledby="bd-grant-heading">
          <div className="bd-section-head">
            <h2 id="bd-grant-heading" className="bd-title">
              {strings.grantSummary.heading}
            </h2>
            <ActionButton variant="ghost" pending={openPending} onClick={onChange}>
              {strings.grantSummary.change}
            </ActionButton>
          </div>
          {grant === null ? (
            <p className="bd-muted">{strings.grantSummary.waitingForScope}</p>
          ) : (
            <dl className="bd-grant-list">
              <dt>{strings.grantSummary.mayRead}</dt>
              <dd>
                {grant.folders.length === 0 ? (
                  <span className="bd-muted">{strings.grantSummary.nothingShared}</span>
                ) : (
                  <ul className="bd-grant-folders">
                    {grant.folders.map((root) => {
                      const { name, parent } = splitFolderPath(root)
                      return (
                        <li key={root}>
                          <span className="bd-folder-name">{name}</span>
                          {parent !== "" && (
                            <span className="bd-folder-parent">
                              <bdi>{parent}</bdi>
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </dd>
              <dt>{strings.grantSummary.commands}</dt>
              <dd>{grant.commands}</dd>
              <dt>{strings.grantSummary.approval}</dt>
              <dd>
                {grant.approvalTone === "muted" ? (
                  grant.approval
                ) : (
                  <span className="bd-approval-risk">
                    <StateMark tone={grant.approvalTone} />
                    {grant.approval}
                  </span>
                )}
              </dd>
            </dl>
          )}
        </section>
        <ActivityRecord entries={view.activity} strings={strings} locale={locale} />
      </main>
      <HomeFooter view={view} bridge={bridge} strings={strings} locale={locale} />
    </>
  )
}

function ActivityRecord({
  entries,
  strings,
  locale,
}: {
  entries: readonly BeaconActivity[]
  strings: DesktopStrings
  locale: DesktopLocale
}) {
  const now = useNow(60_000)
  const liveSince = useDesktopViewStore((state) => state.liveSince)
  const days = useMemo(() => groupActivityByDay(entries, strings, now, locale), [entries, strings, now, locale])
  return (
    <section className="bd-record" aria-labelledby="bd-record-heading">
      <h2 id="bd-record-heading" className="bd-title">
        {strings.record.heading}
      </h2>
      {days.length === 0 ? (
        <p className="bd-empty">{strings.record.empty}</p>
      ) : (
        days.map((day) => (
          <section key={day.key} className="bd-day" aria-label={day.label}>
            <h3 className="bd-day-label">{day.label}</h3>
            <ol className="bd-entries">
              {day.entries.map((entry) => (
                <ActivityRow key={entry.id} entry={entry} fresh={entry.at > liveSince} strings={strings} locale={locale} />
              ))}
            </ol>
          </section>
        ))
      )}
    </section>
  )
}

function ActivityRow({
  entry,
  fresh,
  strings,
  locale,
}: {
  entry: BeaconActivity
  fresh: boolean
  strings: DesktopStrings
  locale: DesktopLocale
}) {
  const outcome = presentOutcome(entry.outcome, strings)
  return (
    <li className={cx("bd-entry", fresh && "bd-entry-fresh")}>
      <time className="bd-entry-time" dateTime={new Date(entry.at).toISOString()}>
        {formatClock(entry.at, locale)}
      </time>
      <span className="bd-entry-body">
        <span className="bd-entry-target">{entry.target}</span>
        <span className="bd-entry-meta">
          <span>{strings.record.verbs[entry.verb]}</span>
          <MarkLabel tone={outcome.tone} label={outcome.label} />
        </span>
      </span>
    </li>
  )
}

function HomeFooter({ view, bridge, strings }: Shared & { view: DesktopView }) {
  const menuOpen = useDesktopViewStore((state) => state.menuOpen)
  const confirmingUnpair = useDesktopViewStore((state) => state.confirmingUnpair)
  const toggleMenu = useDesktopViewStore((state) => state.toggleMenu)
  const askUnpair = useDesktopViewStore((state) => state.askUnpair)
  const cancelUnpair = useDesktopViewStore((state) => state.cancelUnpair)
  const pausedPending = usePendingAction(KEY.paused)
  const loginPending = usePendingAction(KEY.login) || view.busy.launchAtLogin
  const unpairing = usePendingAction(KEY.unpair) || view.busy.unpairing
  const paused = view.prefs.paused
  const osName = strings.osName[view.os]

  const onPause = useCallback(() => {
    runPendingAction(KEY.paused, () => bridge.request("setPaused", { paused: !paused }))
  }, [bridge, paused])
  const onLogin = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const enabled = event.target.checked
      runPendingAction(KEY.login, () => bridge.request("setLaunchAtLogin", { enabled }))
    },
    [bridge],
  )
  const onUnpair = useCallback(() => {
    runPendingAction(KEY.unpair, () => bridge.request("unpair", NO_PARAMS))
  }, [bridge])
  const kanna = view.pairing === null ? "" : hostOf(view.pairing.kannaUrl)
  const moreButton = useRef<HTMLButtonElement>(null)
  const onCancelUnpair = useCallback(() => {
    cancelUnpair()
    moreButton.current?.focus()
  }, [cancelUnpair])

  return (
    <footer className="bd-footer">
      {menuOpen && (
        <div className="bd-menu" id="bd-more-menu">
          {confirmingUnpair ? (
            <div className="bd-confirm" role="alertdialog" aria-labelledby="bd-unpair-text">
              <p id="bd-unpair-text" className="bd-body">
                {strings.footer.unpairConfirm(kanna)}
              </p>
              <div className="bd-row-end">
                <ActionButton variant="ghost" onClick={onCancelUnpair} disabled={unpairing} autoFocus>
                  {strings.footer.cancel}
                </ActionButton>
                <ActionButton variant="destructive" pending={unpairing} onClick={onUnpair}>
                  {strings.footer.unpairConfirmAction}
                </ActionButton>
              </div>
            </div>
          ) : (
            <>
              <label className="bd-check">
                <input type="checkbox" checked={view.prefs.launchAtLogin} onChange={onLogin} disabled={loginPending} />
                <span>{strings.footer.launchAtLogin(osName)}</span>
                {loginPending ? <Spinner /> : null}
              </label>
              <button type="button" className="bd-menu-danger" onClick={askUnpair}>
                {strings.footer.unpair}
              </button>
            </>
          )}
        </div>
      )}
      <div className="bd-footer-bar">
        <ActionButton pending={pausedPending} onClick={onPause}>
          {paused ? strings.footer.resume : strings.footer.pause}
        </ActionButton>
        <button
          ref={moreButton}
          type="button"
          className="bd-icon-button"
          aria-label={strings.footer.more}
          aria-expanded={menuOpen}
          aria-controls="bd-more-menu"
          onClick={toggleMenu}
        >
          <MoreHorizontal className="bd-icon" aria-hidden />
        </button>
      </div>
    </footer>
  )
}
