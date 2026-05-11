import { useState, useCallback, type KeyboardEvent, type ReactNode } from "react"
import { Button } from "../../ui/button"
import { cn } from "../../../lib/utils"

interface StackCreatePanelProps {
  mode: "create" | "edit"
  initialTitle?: string
  initialProjectIds?: string[]
  projects: Array<{ id: string; title: string }>
  onSubmit: (title: string, projectIds: string[]) => Promise<void>
  onCancel: () => void
}

export function StackCreatePanel({
  mode: _mode,
  initialTitle,
  initialProjectIds,
  projects,
  onSubmit,
  onCancel,
}: StackCreatePanelProps): ReactNode {
  const [title, setTitle] = useState<string>(initialTitle ?? "")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initialProjectIds ?? [])
  )

  const hasEnoughProjects = projects.length >= 2
  const isSaveDisabled =
    !hasEnoughProjects || title.trim() === "" || selectedIds.size < 2

  const toggleProject = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleSubmit = useCallback(async () => {
    if (isSaveDisabled) return
    await onSubmit(title.trim(), Array.from(selectedIds))
  }, [isSaveDisabled, onSubmit, title, selectedIds])

  const handleTitleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        void handleSubmit()
      } else if (e.key === "Escape") {
        onCancel()
      }
    },
    [handleSubmit, onCancel]
  )

  const handleWrapperKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        onCancel()
      }
    },
    [onCancel]
  )

  return (
    <div
      className="flex flex-col gap-2 px-2.5 py-2 border border-border rounded-lg bg-background"
      onKeyDown={handleWrapperKeyDown}
    >
      {/* Title input */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleTitleKeyDown}
        placeholder="Stack name"
        autoFocus
        className="w-full text-sm px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {/* Project chip list */}
      <div className="flex flex-wrap gap-1">
        {projects.map((project) => {
          const isSelected = selectedIds.has(project.id)
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => toggleProject(project.id)}
              className={cn(
                "rounded-full px-2 py-0.5 text-xs border transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-foreground"
              )}
            >
              {project.title}
            </button>
          )
        })}
      </div>

      {/* Single-project disabled banner */}
      {!hasEnoughProjects && (
        <p className="text-xs text-muted-foreground">
          Register a second project to create a stack
        </p>
      )}

      {/* Action row */}
      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          size="sm"
          disabled={isSaveDisabled}
          onClick={() => void handleSubmit()}
        >
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
