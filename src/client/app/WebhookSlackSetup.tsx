import { AlertTriangle, ChevronDown } from "lucide-react"
import { SLACK_APP_MANIFEST } from "../../shared/webhooks/slack"
import { cn } from "../lib/utils"
import { isPublicHttpsOrigin, webhookUrl } from "../lib/webhookPresentation"
import { WebhookCopyButton } from "./WebhookCopyButton"
import { WebhookCreateStore } from "./WebhookCreateDialog.store"

interface Props {
  hookId: string | undefined
  origin: string
}

const SLACK_APPS_URL = "https://api.slack.com/apps"

function RequestUrl({ hookId, origin }: Props) {
  if (hookId === undefined) {
    return <p>Save this hook first. The Request URL then appears here and on the webhook row.</p>
  }
  const url = webhookUrl(origin, hookId)
  return (
    <div className="flex items-center gap-1">
      <code className="min-w-0 break-all font-mono text-xs text-foreground">{url}</code>
      <WebhookCopyButton copyId={`${hookId}-slack-request-url`} text={url} label="Copy Request URL" />
    </div>
  )
}

function ReachabilityNote({ origin }: { origin: string }) {
  if (isPublicHttpsOrigin(origin)) {
    return <p className="text-xs text-muted-foreground">Slack reaches Kanna at {origin}.</p>
  }
  return (
    <p className="flex items-start gap-2 rounded-lg border border-border bg-warning/[0.06] px-3 py-2 text-xs text-foreground">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Slack must reach Kanna over a public HTTPS URL, for example a named Cloudflare tunnel. This page is at{" "}
        <code className="font-mono">{origin}</code>, which Slack cannot reach.
      </span>
    </p>
  )
}

export function WebhookSlackSetup({ hookId, origin }: Props) {
  const open = WebhookCreateStore.useScopedStore((state) => state.slackSetupOpen)
  const toggle = WebhookCreateStore.useScopedStore((state) => state.toggleSlackSetup)
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-foreground"
        aria-expanded={open}
        aria-controls="webhook-slack-setup"
        onClick={toggle}
      >
        Set up the Slack app
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <div id="webhook-slack-setup" className="space-y-3 border-t border-border px-3 py-3">
          <ReachabilityNote origin={origin} />
          <ol className="list-decimal space-y-3 pl-5 text-xs text-muted-foreground">
            <li className="space-y-1.5">
              <p>
                Open{" "}
                <a className="text-foreground underline" href={SLACK_APPS_URL} target="_blank" rel="noreferrer">
                  api.slack.com/apps
                </a>
                , choose Create New App, then From a manifest, and paste this manifest.
              </p>
              <div className="flex items-start gap-1">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-background p-2 font-mono text-xs text-foreground">
                  {SLACK_APP_MANIFEST}
                </pre>
                <WebhookCopyButton copyId="slack-app-manifest" text={SLACK_APP_MANIFEST} label="Copy app manifest" />
              </div>
            </li>
            <li>
              Install the app to your workspace. Copy the Bot User OAuth Token (<code className="font-mono">xoxb-</code>)
              from OAuth &amp; Permissions and the Signing Secret from Basic Information into the fields above.
            </li>
            <li>Save this hook.</li>
            <li className="space-y-1.5">
              <p>
                In Event Subscriptions, enable events, paste this Request URL, and subscribe to the bot event{" "}
                <code className="font-mono">app_mention</code>.
              </p>
              <RequestUrl hookId={hookId} origin={origin} />
            </li>
            <li>
              In the channel, run <code className="font-mono">/invite @Kanna</code>.
            </li>
          </ol>
        </div>
      ) : null}
    </div>
  )
}
