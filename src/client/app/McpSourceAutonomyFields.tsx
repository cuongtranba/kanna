import { INBOX_AUTONOMY_LEVELS } from "../../shared/inbox/autonomy"
import { Input } from "../components/ui/input"
import { SegmentedControl, type SegmentedOption } from "../components/ui/segmented-control"
import { Textarea } from "../components/ui/textarea"
import { INBOX_AUTONOMY_LEVEL_LABEL } from "../lib/inboxAutonomy"
import type { McpSourceDraft } from "../lib/mcpSourceDraft"
import { Field } from "./McpSourceFormField"

const LEVEL_OPTIONS: SegmentedOption<McpSourceDraft["autonomyLevel"]>[] = INBOX_AUTONOMY_LEVELS.map((level) => ({
  value: level,
  label: INBOX_AUTONOMY_LEVEL_LABEL[level],
}))

const LEVEL_CONSEQUENCE = {
  off: "The agent only reads and reports. It cannot propose a reply.",
  suggest: "The agent proposes a reply and Kanna saves it as a draft you can edit and send.",
  approve: "The agent proposes a reply and Kanna shows an approval card. Nothing is sent until you press Send.",
  auto: "Kanna sends the reply after the delay unless a guardrail blocks it, and you can Undo until then. Guardrails that fail turn it into an approval card.",
} as const satisfies Record<McpSourceDraft["autonomyLevel"], string>

interface Props {
  draft: McpSourceDraft
  onChange: (patch: Partial<McpSourceDraft>) => void
}

export function McpSourceAutonomyFields({ draft, onChange }: Props) {
  return (
    <section aria-label="Autonomy" className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">Autonomy</h3>
        <p className="text-xs text-muted-foreground">
          How far the agent may go when it wants to reply. Approve and Auto need a reply tool above, and Auto also needs a Claude handler model, because only Claude turns can be stopped from sending on their own. Each thread can override this level in the Inbox.
        </p>
      </div>
      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-foreground">Level</span>
        <SegmentedControl value={draft.autonomyLevel} onValueChange={(autonomyLevel) => onChange({ autonomyLevel })} options={LEVEL_OPTIONS} size="sm" />
        <p className="text-xs text-muted-foreground">{LEVEL_CONSEQUENCE[draft.autonomyLevel]}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="mcp-source-autonomy-threshold" label="Confidence threshold" hint="Auto only when the agent's confidence, from 0 to 1, is at least this.">
          <Input id="mcp-source-autonomy-threshold" inputMode="decimal" className="tabular-nums" value={draft.autonomyThreshold} onChange={(event) => onChange({ autonomyThreshold: event.target.value })} />
        </Field>
        <Field id="mcp-source-autonomy-delay" label="Send delay (seconds)" hint="How long an auto-send waits so you can Undo it. 10 to 300.">
          <Input id="mcp-source-autonomy-delay" inputMode="numeric" className="tabular-nums" value={draft.autonomySendDelaySeconds} onChange={(event) => onChange({ autonomySendDelaySeconds: event.target.value })} />
        </Field>
        <Field id="mcp-source-autonomy-thread-cap" label="Auto-sends per thread per hour">
          <Input id="mcp-source-autonomy-thread-cap" inputMode="numeric" className="tabular-nums" value={draft.autonomyPerThreadPerHour} onChange={(event) => onChange({ autonomyPerThreadPerHour: event.target.value })} />
        </Field>
        <Field id="mcp-source-autonomy-source-cap" label="Auto-sends per source per day">
          <Input id="mcp-source-autonomy-source-cap" inputMode="numeric" className="tabular-nums" value={draft.autonomyPerSourcePerDay} onChange={(event) => onChange({ autonomyPerSourcePerDay: event.target.value })} />
        </Field>
        <Field id="mcp-source-autonomy-quiet-start" label="Quiet hours start" hint="Server local time. Leave both empty for none; Auto becomes an approval card inside quiet hours.">
          <Input id="mcp-source-autonomy-quiet-start" type="time" className="tabular-nums" value={draft.autonomyQuietStart} onChange={(event) => onChange({ autonomyQuietStart: event.target.value })} />
        </Field>
        <Field id="mcp-source-autonomy-quiet-end" label="Quiet hours end">
          <Input id="mcp-source-autonomy-quiet-end" type="time" className="tabular-nums" value={draft.autonomyQuietEnd} onChange={(event) => onChange({ autonomyQuietEnd: event.target.value })} />
        </Field>
        <Field id="mcp-source-autonomy-max-chars" label="Max characters" hint="Longer replies need your approval.">
          <Input id="mcp-source-autonomy-max-chars" inputMode="numeric" className="tabular-nums" value={draft.autonomyMaxChars} onChange={(event) => onChange({ autonomyMaxChars: event.target.value })} />
        </Field>
      </div>
      <Field id="mcp-source-autonomy-allowlist" label="Auto allowlist" hint="One thread key per line. Auto only sends to these contacts; you can also add one from a thread in the Inbox.">
        <Textarea id="mcp-source-autonomy-allowlist" rows={3} className="font-mono" value={draft.autonomyAllowlist} onChange={(event) => onChange({ autonomyAllowlist: event.target.value })} />
      </Field>
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={draft.autonomyAllowUrls}
          onChange={(event) => onChange({ autonomyAllowUrls: event.target.checked })}
          className="h-4 w-4 shrink-0 rounded border-border accent-foreground"
        />
        Allow links in auto-sent replies
      </label>
    </section>
  )
}
