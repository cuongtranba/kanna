import { useCallback, useEffect } from "react"
import { useNow } from "../../../client/hooks/useNow"
import { runPendingAction, usePendingAction } from "../../../client/stores/pendingActionsStore"
import { BEACON_DOWNLOAD_PAGE } from "../../../shared/beacon-pair-link"
import type { DesktopNotice, DesktopScreen, DesktopView } from "../desktop-types"
import type { DesktopStrings } from "../strings"
import { NO_PARAMS } from "./bridge"
import { presentStatus } from "./present"
import { useDesktopViewStore } from "./view-store"
import { ActionButton, hostOf, KEY, MarkLabel, unbreakable, type Shared } from "./parts"
import { ConfirmScreen, WelcomeScreen } from "./PairingScreens"
import { GrantScreen } from "./GrantScreen"
import { HomeScreen } from "./HomeScreen"


export function BeaconDesktopView({ bridge, strings, locale }: Shared) {
  const view = useDesktopViewStore((state) => state.view)
  const receiveView = useDesktopViewStore((state) => state.receiveView)

  useEffect(() => bridge.onView(receiveView), [bridge, receiveView])
  useEffect(() => {
    bridge.announceLocale(locale)
    runPendingAction("beacon.getView", async () => receiveView(await bridge.request("getView", NO_PARAMS)))
  }, [bridge, locale, receiveView])

  if (view === null) {
    return (
      <div className="bd-shell" aria-busy>
        <Wordmark strings={strings} />
      </div>
    )
  }
  return (
    <div className="bd-shell">
      <Wordmark strings={strings} />
      {view.pairing !== null && <StatusBlock view={view} bridge={bridge} strings={strings} locale={locale} />}
      {view.notice !== null && <NoticeBanner notice={view.notice} view={view} bridge={bridge} strings={strings} />}
      <Screen screen={view.screen} view={view} bridge={bridge} strings={strings} locale={locale} />
    </div>
  )
}

function Wordmark({ strings }: { strings: DesktopStrings }) {
  return (
    <header className="bd-wordmark">
      <span className="bd-wordmark-name">{strings.appName}</span>
    </header>
  )
}

function Screen({ screen, ...shared }: Shared & { screen: DesktopScreen; view: DesktopView }) {
  switch (screen.kind) {
    case "welcome":
      return <WelcomeScreen inputRejected={screen.inputRejected} {...shared} />
    case "confirm":
      return <ConfirmScreen screen={screen} {...shared} />
    case "grant":
      return <GrantScreen screen={screen} {...shared} />
    case "home":
      return <HomeScreen {...shared} />
  }
}

function StatusBlock({ view, bridge, strings, locale }: Shared & { view: DesktopView }) {
  const now = useNow(1_000)
  const pairing = view.pairing
  const onPairAgain = useCallback(() => {
    runPendingAction(KEY.unpair, () => bridge.request("unpair", NO_PARAMS))
  }, [bridge])
  const onDownload = useCallback(() => {
    runPendingAction(KEY.external, () => bridge.request("openExternal", { url: BEACON_DOWNLOAD_PAGE }))
  }, [bridge])
  const unpairing = usePendingAction(KEY.unpair)
  if (pairing === null) return null
  const presented = view.runner === null ? null : presentStatus(view.runner, strings, now, locale)
  const phase = view.runner?.status.phase
  return (
    <section className="bd-status" aria-live="polite">
      <div className="bd-status-line">
        {presented !== null && <MarkLabel tone={presented.tone} label={presented.label} />}
        <span className="bd-status-host">{hostOf(pairing.kannaUrl)}</span>
      </div>
      <p className="bd-status-meta">
        <span>{view.machine}</span>
        {presented !== null && presented.detail !== "" && <span className="bd-tabular">{presented.detail}</span>}
      </p>
      {phase === "revoked" && (
        <ActionButton variant="primary" pending={unpairing} onClick={onPairAgain}>
          {strings.footer.pairAgain}
        </ActionButton>
      )}
      {phase === "incompatible" && <ActionButton onClick={onDownload}>{strings.footer.download}</ActionButton>}
    </section>
  )
}

function NoticeBanner({
  notice,
  view,
  bridge,
  strings,
}: Omit<Shared, "locale"> & { notice: DesktopNotice; view: DesktopView }) {
  const pending = usePendingAction(KEY.dismiss)
  const onDismiss = useCallback(() => {
    runPendingAction(KEY.dismiss, () => bridge.request("dismissNotice", NO_PARAMS))
  }, [bridge])
  const lines =
    notice.kind === "already-paired"
      ? [strings.notices.alreadyPaired(hostOf(notice.kannaUrl))]
      : [
          strings.notices.unpaired,
          ...(notice.kannaInformed ? [] : [strings.notices.unpairedNotInformed(unbreakable(view.machine))]),
        ]
  return (
    <aside className="bd-notice" role="status">
      <div className="bd-notice-text">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <ActionButton variant="ghost" pending={pending} onClick={onDismiss}>
        {strings.notices.dismiss}
      </ActionButton>
    </aside>
  )
}

