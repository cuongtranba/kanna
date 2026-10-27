import { ExternalLink, Loader2, Trash2 } from "lucide-react"
import type { PackageUpdateEntry } from "../../../shared/packages/types"
import type { InstalledSkillSummary } from "../../../shared/types"
import { AvailabilityPill, UpdateActionButton, updateActionLabel } from "./PackageUpdateBadge"

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
  const version = packageEntry?.versionLabel ?? packageEntry?.revision?.slice(0, 7) ?? packageEntry?.updatedAt ?? null
  const pinnedRef = packageEntry?.pinnedRef ?? null
  const action = updateActionLabel(packageEntry)

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
        <AvailabilityPill availability={packageEntry?.update.availability} />
        {action ? <UpdateActionButton label={action} updating={applying} onClick={onUpdate} /> : null}
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
