import { SegmentedControl, type SegmentedOption } from "../components/ui/segmented-control"
import { Spinner } from "../components/ui/spinner"
import { runPendingAction, usePendingAction } from "../stores/pendingActionsStore"

interface PendingSegmentedControlProps<T extends string> {
  pendingKey: string
  value: T
  onValueChange: (value: T) => Promise<void>
  options: SegmentedOption<T>[]
  size?: "sm" | "md"
}

function disableAll<T extends string>(options: SegmentedOption<T>[]): SegmentedOption<T>[] {
  return options.map((option) => ({ ...option, disabled: true }))
}

export function PendingSegmentedControl<T extends string>({
  pendingKey,
  value,
  onValueChange,
  options,
  size,
}: PendingSegmentedControlProps<T>) {
  const pending = usePendingAction(pendingKey)
  return (
    <div className="inline-flex items-center gap-2" aria-busy={pending || undefined}>
      {pending ? <Spinner className="text-muted-foreground" /> : null}
      <SegmentedControl
        value={value}
        onValueChange={(next) => runPendingAction(pendingKey, () => onValueChange(next))}
        options={pending ? disableAll(options) : options}
        size={size}
      />
    </div>
  )
}
