import { useCallback, type ChangeEvent } from "react"
import type { WebhookSummary } from "../../shared/webhooks/types"
import { Input } from "../components/ui/input"
import { describeSavedSecret, KEEP_SAVED_SECRET_PLACEHOLDER } from "../lib/webhookPresentation"
import { WebhookCreateStore } from "./WebhookCreateDialog.store"
import { WebhookSlackSetup } from "./WebhookSlackSetup"

interface Props {
  editing: WebhookSummary | undefined
  origin: string
}

interface SecretFieldProps {
  id: string
  label: string
  value: string
  savedHint: string | undefined
  placeholder: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}

function SecretField({ id, label, value, savedHint, placeholder, onChange }: SecretFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      <Input
        id={id}
        type="password"
        autoComplete="new-password"
        className="font-mono"
        value={value}
        onChange={onChange}
        placeholder={savedHint === undefined ? placeholder : KEEP_SAVED_SECRET_PLACEHOLDER}
      />
      {savedHint === undefined ? null : <p className="text-xs text-muted-foreground tabular-nums">{describeSavedSecret(savedHint)}</p>}
    </div>
  )
}

export function WebhookSlackFields({ editing, origin }: Props) {
  const signingSecret = WebhookCreateStore.useScopedStore((state) => state.signingSecret)
  const botToken = WebhookCreateStore.useScopedStore((state) => state.botToken)
  const allowedUserIds = WebhookCreateStore.useScopedStore((state) => state.allowedUserIds)
  const setSigningSecret = WebhookCreateStore.useScopedStore((state) => state.setSigningSecret)
  const setBotToken = WebhookCreateStore.useScopedStore((state) => state.setBotToken)
  const setAllowedUserIds = WebhookCreateStore.useScopedStore((state) => state.setAllowedUserIds)
  const handleSigningSecretChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setSigningSecret(event.target.value),
    [setSigningSecret],
  )
  const handleBotTokenChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setBotToken(event.target.value),
    [setBotToken],
  )
  const handleAllowedUserIdsChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setAllowedUserIds(event.target.value),
    [setAllowedUserIds],
  )
  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <SecretField
          id="webhook-slack-signing-secret"
          label="Signing Secret"
          value={signingSecret}
          savedHint={editing?.secretHint}
          placeholder="From Basic Information"
          onChange={handleSigningSecretChange}
        />
        <SecretField
          id="webhook-slack-bot-token"
          label="Bot Token"
          value={botToken}
          savedHint={editing?.slack?.botTokenHint}
          placeholder="xoxb-…"
          onChange={handleBotTokenChange}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="webhook-slack-members" className="text-sm font-medium text-foreground">Allowed Slack member IDs</label>
        <Input
          id="webhook-slack-members"
          className="font-mono"
          value={allowedUserIds}
          onChange={handleAllowedUserIdsChange}
          placeholder="U01ABCDEF, U02GHIJKL"
        />
        <p className="text-xs text-muted-foreground">
          Only these people can start a chat. Separate IDs with commas or spaces. Slack profile → ⋯ → Copy member ID.
        </p>
      </div>
      <WebhookSlackSetup hookId={editing?.id} origin={origin} />
    </div>
  )
}
