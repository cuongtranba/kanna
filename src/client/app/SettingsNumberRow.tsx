import type { ReactNode } from "react"
import { SettingsRow } from "../components/settings/SettingsList"
import { Input } from "../components/ui/input"
import { handleTextInputKeyDown } from "../lib/settings-input"
import { cn } from "../lib/utils"

interface Props {
  title: string
  description: string
  min: number
  max?: number
  step: number
  value: string
  onValueChange: (value: string) => void
  onCommit: () => void
  hint: ReactNode
  unit?: string
  ariaLabel?: string
  bordered?: boolean
}

export function SettingsNumberRow({ title, description, min, max, step, value, onValueChange, onCommit, hint, unit, ariaLabel, bordered }: Props) {
  const input = (
    <Input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => handleTextInputKeyDown(event, onCommit)}
      className={cn(
        "hide-number-steppers w-full text-left font-mono",
        unit ? "tabular-nums md:w-24 md:text-right" : "md:w-28 md:text-right",
      )}
      aria-label={ariaLabel}
    />
  )
  return (
    <SettingsRow title={title} description={description} bordered={bordered}>
      <div className="flex w-full min-w-0 flex-col items-stretch gap-2 md:w-auto md:items-end">
        {unit ? (
          <div className="flex items-center gap-2 md:justify-end">
            {input}
            <span className="text-sm text-muted-foreground">{unit}</span>
          </div>
        ) : (
          input
        )}
        <div className={cn("text-left text-xs text-muted-foreground md:text-right", unit && "tabular-nums")}>{hint}</div>
      </div>
    </SettingsRow>
  )
}
