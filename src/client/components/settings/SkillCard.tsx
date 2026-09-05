import { ExternalLink, Loader2, Trash2 } from "lucide-react"
import { Button } from "../ui/button"
import { STATUS_PILL_CLASS } from "../../../shared/design/tone-pairings"
import { repinTarget } from "../../../shared/packages/skill-update-classifier"
import type { UpdateAvailability } from "../../../shared/packages/types"
import type { PackageUpdateEntry } from "../../../shared/packages/types"
import type { InstalledSkillSummary } from "../../../shared/types"
import { cn } from "../../lib/utils"

const AVAILABILITY_LABEL: Record<UpdateAvailability, string> = {
  up_to_date: "Up to date",
  outdated: "Outdated",
  partial: "Partial",
  unknown: "Unknown",
}

function actionLabel(entry: PackageUpdateEntry | null): string | null {
  if (!entry) return null
  const repinTo = repinTarget(entry, entry.update)
  if (repinTo) return `Re-pin to ${repinTo}`
  if (entry.pinnedRef) return null
  const avail = entry.update.availability
  return avail === "outdated" || avail === "partial" ? "Update" : null
}

export function InstalledSkillCard({
  skill,
  packageEntry,
  uninstalling,
  applying,
  onUninstall,
  onUpdate,
}: {
  skill: InstalledSkillSummary
  packageEntry: PackageUpdateEntry | null
  uninstalling: boolean
  applying: boolean
  onUninstall: () => void
  onUpdate: () => void
}) {
  const href = skill.source ? `https://skills.sh/${skill.source}/${skill.name}` : null
  const avail = packageEntry?.update.availability
  const version = packageEntry?.versionLabel ?? packageEntry?.revision?.slice(0, 7) ?? packageEntry?.updatedAt ?? null
  const pillClass = avail && avail !== "up_to_date" ? STATUS_PILL_CLASS[avail] : null
  const pinnedRef = packageEntry?.pinnedRef ?? null
  const action = actionLabel(packageEntry)

  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-border bg-card/30 p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{skill.name}</div>
        <div className="truncate text-xs text-muted-foreground">{skill.source || "Unknown source"}</div>
        {version ? <div className="font-mono tabular-nums text-xs text-muted-foreground/70">{version}</div> : null}
        {pinnedRef ? (
          <div className="truncate font-mono tabular-nums text-xs text-muted-foreground/70">Pinned {pinnedRef}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {pillClass ? (
          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", pillClass)}>
            {AVAILABILITY_LABEL[avail!]}
          </span>
        ) : null}
        {action ? (
          <Button type="button" size="sm" variant="secondary" disabled={applying} onClick={onUpdate} className="h-6 rounded-full px-2 text-xs">
            {applying ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}{action}
          </Button>
        ) : null}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" aria-label={`View ${skill.name} on skills.sh`} className="touch-manipulation inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
        <button type="button" aria-label={`Uninstall ${skill.name}`} disabled={uninstalling} onClick={onUninstall} className="touch-manipulation inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50">
          {uninstalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
