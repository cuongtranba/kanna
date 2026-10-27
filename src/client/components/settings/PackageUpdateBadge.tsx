import { Loader2 } from "lucide-react"
import { Button } from "../ui/button"
import { STATUS_PILL_CLASS } from "../../../shared/design/tone-pairings"
import { repinTarget } from "../../../shared/packages/skill-update-classifier"
import type { PackageUpdateEntry, UpdateAvailability } from "../../../shared/packages/types"
import { cn } from "../../lib/utils"

const AVAILABILITY_LABEL: Record<Exclude<UpdateAvailability, "up_to_date">, string> = {
  outdated: "Outdated",
  partial: "Partial",
  unknown: "Unknown",
}

export function updateActionLabel(entry: PackageUpdateEntry | null): string | null {
  if (!entry) return null
  const repinTo = repinTarget(entry, entry.update)
  if (repinTo) return `Re-pin to ${repinTo}`
  if (entry.pinnedRef) return null
  const availability = entry.update.availability
  return availability === "outdated" || availability === "partial" ? "Update" : null
}

export function AvailabilityPill({ availability }: { availability: UpdateAvailability | undefined }) {
  if (availability === undefined || availability === "up_to_date") return null
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_PILL_CLASS[availability])}>
      {AVAILABILITY_LABEL[availability]}
    </span>
  )
}

export function UpdateActionButton({ label, updating, onClick }: { label: string; updating: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={updating}
      aria-busy={updating || undefined}
      onClick={onClick}
      className="h-6 rounded-full px-2 text-xs"
    >
      {updating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}{label}
    </Button>
  )
}
