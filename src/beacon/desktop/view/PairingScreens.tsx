import { useCallback, type ChangeEvent, type FormEvent } from "react"
import { runPendingAction, usePendingAction } from "../../../client/stores/pendingActionsStore"
import type { DesktopPairError, DesktopScreen, DesktopView } from "../desktop-types"
import type { DesktopStrings } from "../strings"
import { NO_PARAMS } from "./bridge"
import { useDesktopViewStore } from "./view-store"
import { ActionButton, hostOf, KEY, MarkLabel, type Shared } from "./parts"

export function WelcomeScreen({ inputRejected, bridge, strings }: Shared & { inputRejected: boolean; view: DesktopView }) {
  const pasteText = useDesktopViewStore((state) => state.pasteText)
  const setPasteText = useDesktopViewStore((state) => state.setPasteText)
  const pending = usePendingAction(KEY.submit)
  const onChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setPasteText(event.target.value),
    [setPasteText],
  )
  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      runPendingAction(KEY.submit, () => bridge.request("submitPairingInput", { text: pasteText }))
    },
    [bridge, pasteText],
  )
  return (
    <main className="bd-screen">
      <h1 className="bd-headline">{strings.welcome.title}</h1>
      <p className="bd-lead">{strings.welcome.lead}</p>
      <ol className="bd-steps">
        <li>{strings.welcome.stepOpenKanna}</li>
        <li>{strings.welcome.stepClickLink}</li>
      </ol>
      <p className="bd-waiting">
        <MarkLabel tone="attention" label={strings.welcome.waiting} />
      </p>
      <form className="bd-paste" onSubmit={onSubmit}>
        <label htmlFor="bd-paste-input" className="bd-label">
          {strings.welcome.pasteLabel}
        </label>
        <textarea
          id="bd-paste-input"
          className="bd-input bd-input-mono"
          rows={2}
          spellCheck={false}
          placeholder={strings.welcome.pastePlaceholder}
          value={pasteText}
          onChange={onChange}
          aria-invalid={inputRejected || undefined}
          aria-describedby={inputRejected ? "bd-paste-error" : undefined}
        />
        {inputRejected && (
          <p id="bd-paste-error" className="bd-error" role="alert">
            {strings.welcome.pasteRejected}
          </p>
        )}
        <div className="bd-row-end">
          <ActionButton type="submit" variant="primary" pending={pending} disabled={pasteText.trim() === ""}>
            {strings.welcome.pasteSubmit}
          </ActionButton>
        </div>
      </form>
      <p className="bd-footnote">{strings.welcome.downloadNote}</p>
    </main>
  )
}

function pairErrorText(error: DesktopPairError, strings: DesktopStrings): string {
  switch (error.kind) {
    case "expired":
      return strings.confirm.errors.expired
    case "unknown-code":
      return strings.confirm.errors.unknownCode
    case "needs-password":
      return strings.confirm.errors.needsPassword
    case "unreachable":
      return strings.confirm.errors.unreachable(error.detail)
    case "other":
      return strings.confirm.errors.other(error.detail)
  }
}

export function ConfirmScreen({
  screen,
  view,
  bridge,
  strings,
}: Shared & { screen: Extract<DesktopScreen, { kind: "confirm" }>; view: DesktopView }) {
  const onConnect = useCallback(() => {
    runPendingAction(KEY.confirm, () => bridge.request("confirmPairing", NO_PARAMS))
  }, [bridge])
  const onCancel = useCallback(() => {
    runPendingAction(KEY.cancel, () => bridge.request("cancelPairing", NO_PARAMS))
  }, [bridge])
  const url = screen.target.kannaUrl
  return (
    <main className="bd-screen">
      <h1 className="bd-headline">{strings.confirm.title}</h1>
      <div className="bd-address">
        <span className="bd-address-host">{hostOf(url)}</span>
        <span className="bd-address-url">{url}</span>
      </div>
      <p className="bd-body">{strings.confirm.appearsAs(view.machine)}</p>
      <p className="bd-body bd-muted">{strings.confirm.warning}</p>
      {screen.error !== null && (
        <p className="bd-error" role="alert">
          {pairErrorText(screen.error, strings)}
        </p>
      )}
      <div className="bd-row-end">
        <ActionButton variant="ghost" onClick={onCancel} disabled={screen.pairing}>
          {strings.confirm.cancel}
        </ActionButton>
        <ActionButton variant="primary" pending={screen.pairing} onClick={onConnect}>
          {screen.pairing ? strings.confirm.connecting : strings.confirm.connect}
        </ActionButton>
      </div>
    </main>
  )
}

