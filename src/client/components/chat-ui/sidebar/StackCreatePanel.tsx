import { useState, useCallback, useRef, type KeyboardEvent, type FormEvent, type ReactNode } from "react"
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
  const chipContainerRef = useRef<HTMLDivElement>(null)

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

  // Fix 2: form submit handler receives FormEvent
  const handleFormSubmit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isSaveDisabled) return
    await onSubmit(title.trim(), Array.from(selectedIds))
  }, [isSaveDisabled, onSubmit, title, selectedIds])

  // Fix 2: only handle Escape on the form wrapper (no double-fire with input)
  const handleEscapeKey = useCallback(
    (e: KeyboardEvent<HTMLFormElement>) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
      }
    },
    [onCancel]
  )

  // Fix 2: title input only needs Escape (Enter is handled natively by the form)
  const handleTitleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        onCancel()
      }
    },
    [onCancel]
  )

  // Fix 3 & 4: chip keyboard handler — Cmd/Ctrl+Enter to submit, ArrowLeft/Right to navigate
  const handleChipKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (!isSaveDisabled) {
          void onSubmit(title.trim(), Array.from(selectedIds))
        }
      } else if (e.key === "ArrowRight") {
        const chips = chipContainerRef.current?.querySelectorAll("button")
        if (chips) {
          const next = chips[index + 1] as HTMLButtonElement | undefined
          next?.focus()
        }
      } else if (e.key === "ArrowLeft") {
        const chips = chipContainerRef.current?.querySelectorAll("button")
        if (chips) {
          const prev = chips[index - 1] as HTMLButtonElement | undefined
          prev?.focus()
        }
      }
    },
    [isSaveDisabled, onSubmit, title, selectedIds]
  )

  return (
    // Fix 1 & 2: root element is now <form>, handleWrapperKeyDown removed
    <form
      onSubmit={handleFormSubmit}
      onKeyDown={handleEscapeKey}
      className="flex flex-col gap-2 px-2.5 py-2 border border-border rounded-lg bg-background"
    >
      {/* Title input — Fix 5: aria-label added */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleTitleKeyDown}
        placeholder="Stack name"
        aria-label="Stack name"
        autoFocus
        className="w-full text-sm px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {/* Project chip list */}
      <div ref={chipContainerRef} className="flex flex-wrap gap-1">
        {projects.map((project, index) => {
          const isSelected = selectedIds.has(project.id)
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => toggleProject(project.id)}
              onKeyDown={(e) => handleChipKeyDown(e, index)}
              aria-pressed={isSelected}
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
    </form>
  )
}
