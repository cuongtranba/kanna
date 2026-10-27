import type { ReactNode } from "react"
import type { InboundHandlerMode } from "../../shared/inbound/handler"
import { SearchableSelect, type SearchableOption } from "../components/ui/searchable-select"
import { SegmentedControl, type SegmentedOption } from "../components/ui/segmented-control"
import { inboundModeConsequence, inboundModeLabel } from "../lib/webhookPresentation"
import type { InboundTargets } from "../lib/webhookTargets"

const MODE_OPTIONS: SegmentedOption<InboundHandlerMode>[] = (["notify", "inline", "spawn"] as const).map((mode) => ({
  value: mode,
  label: inboundModeLabel(mode),
}))

interface Props {
  idPrefix: string
  mode: InboundHandlerMode
  chatId: string
  projectId: string
  modelValue: string
  targets: InboundTargets
  modelOptions: readonly SearchableOption[]
  modelHint: string
  showModeControl: boolean
  startsTurn: boolean
  targetNote?: ReactNode
  beforeModel?: ReactNode
  onModeChange: (mode: InboundHandlerMode) => void
  onChatChange: (chatId: string) => void
  onProjectChange: (projectId: string) => void
  onModelChange: (modelValue: string) => void
}

export function InboundHandlerFields(props: Props) {
  const targetId = `${props.idPrefix}-target`
  const modelId = `${props.idPrefix}-model`
  return (
    <>
      {props.showModeControl ? (
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-foreground">Action</span>
          <SegmentedControl value={props.mode} onValueChange={props.onModeChange} options={MODE_OPTIONS} size="sm" />
          <p className="text-xs text-muted-foreground">{inboundModeConsequence(props.mode)}</p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={targetId} className="block text-sm font-medium text-foreground">
          {props.mode === "spawn" ? "Project" : "Chat"}
        </label>
        {props.mode === "spawn" ? (
          <SearchableSelect
            id={targetId}
            value={props.projectId}
            options={props.targets.projects}
            placeholder="Choose a project"
            searchPlaceholder="Search projects..."
            emptyMessage="Nothing to choose from yet"
            onValueChange={props.onProjectChange}
          />
        ) : (
          <SearchableSelect
            id={targetId}
            value={props.chatId}
            options={props.targets.chats}
            placeholder="Choose a chat"
            searchPlaceholder="Search chats..."
            emptyMessage="Nothing to choose from yet"
            onValueChange={props.onChatChange}
          />
        )}
        {props.targetNote}
      </div>

      {props.beforeModel}

      {props.startsTurn ? (
        <div className="space-y-1.5">
          <label htmlFor={modelId} className="block text-sm font-medium text-foreground">Model</label>
          <SearchableSelect
            id={modelId}
            value={props.modelValue}
            options={props.modelOptions}
            placeholder="Choose a model"
            searchPlaceholder="Search models..."
            onValueChange={props.onModelChange}
          />
          <p className="text-xs text-muted-foreground">{props.modelHint}</p>
        </div>
      ) : null}
    </>
  )
}
