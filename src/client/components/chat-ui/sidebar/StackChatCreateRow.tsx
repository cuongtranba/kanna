import {
  useState,
  useCallback,
  useId,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Button } from "../../ui/button"
import { cn } from "../../../lib/utils"
import { useIsMobile } from "../../../hooks/useIsMobile"
import type { GitWorktree, StackSummary } from "../../../../shared/types"

interface StackChatCreateRowProps {
  stack: StackSummary
  projects: Array<{ id: string; title: string; worktrees: GitWorktree[] }>
  onCreate: (args: {
    primaryProjectId: string
    stackBindings: Array<{ projectId: string; worktreePath: string; role: "primary" | "additional" }>
  }) => Promise<void>
  onCancel: () => void
}

export function StackChatCreateRow({
  stack,
  projects,
  onCreate,
  onCancel,
}: StackChatCreateRowProps): ReactNode {
  const filteredProjects = projects.filter((p) => stack.projectIds.includes(p.id))
  const isMobile = useIsMobile()
  const errorId = useId()

  const [selectedWorktrees, setSelectedWorktrees] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>()
    for (const p of filteredProjects) {
      const primary = p.worktrees.find((w) => w.isPrimary) ?? p.worktrees[0]
      if (primary) map.set(p.id, primary.path)
    }
    return map
  })

  const [primaryProjectId, setPrimaryProjectId] = useState(filteredProjects[0]?.id ?? "")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isSingleProject = filteredProjects.length <= 1

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (isSubmitting) return
      setErrorMessage(null)
      setIsSubmitting(true)
      try {
        const stackBindings = filteredProjects.map((p) => ({
          projectId: p.id,
          worktreePath: selectedWorktrees.get(p.id) ?? p.worktrees[0]?.path ?? "",
          role: (p.id === primaryProjectId ? "primary" : "additional") as "primary" | "additional",
        }))
        await onCreate({ primaryProjectId, stackBindings })
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Could not create chat. Try again.")
        setIsSubmitting(false)
      }
    },
    [filteredProjects, selectedWorktrees, primaryProjectId, onCreate, isSubmitting]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLFormElement>) => {
      if (e.key === "Escape" && !isSubmitting) {
        e.preventDefault()
        onCancel()
      }
    },
    [onCancel, isSubmitting]
  )

  const body = (
    <form
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      aria-busy={isSubmitting}
      aria-describedby={errorMessage ? errorId : undefined}
      className={cn(
        "flex flex-col gap-3",
        !isMobile && "px-3 py-3 border border-border rounded-lg bg-card"
      )}
    >
      <fieldset disabled={isSubmitting} className="contents">
        <ul className="flex flex-col gap-3">
          {filteredProjects.map((project) => {
            const selectedPath = selectedWorktrees.get(project.id) ?? project.worktrees[0]?.path ?? ""
            const isPrimary = project.id === primaryProjectId
            const onlyOneWorktree = project.worktrees.length <= 1

            return (
              <li key={project.id} className="flex flex-col gap-1.5 min-w-0">
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                  <span
                    className="text-[15px] font-semibold leading-snug truncate min-w-0"
                    title={project.title}
                  >
                    {project.title}
                  </span>
                  {!isSingleProject && (
                    <label className="shrink-0 inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                      <input
                        type="radio"
                        name="primaryProject"
                        value={project.id}
                        checked={isPrimary}
                        onChange={() => setPrimaryProjectId(project.id)}
                        aria-label={`Set ${project.title} as primary`}
                        className="accent-foreground"
                      />
                      <span className={isPrimary ? "text-foreground" : undefined}>Primary</span>
                    </label>
                  )}
                </div>

                <select
                  value={selectedPath}
                  onChange={(e) => {
                    setSelectedWorktrees((prev) => {
                      const next = new Map(prev)
                      next.set(project.id, e.target.value)
                      return next
                    })
                  }}
                  disabled={onlyOneWorktree}
                  className="w-full text-[13px] font-mono tabular-nums border border-border rounded-md px-2 py-1.5 bg-background text-foreground truncate disabled:opacity-70 disabled:cursor-not-allowed"
                  aria-label={`Worktree for ${project.title}`}
                >
                  {project.worktrees.map((wt) => (
                    <option key={wt.path} value={wt.path}>
                      {wt.branch}
                    </option>
                  ))}
                </select>
              </li>
            )
          })}
        </ul>

        {errorMessage && (
          <p
            id={errorId}
            role="alert"
            className="text-xs leading-snug text-destructive"
          >
            {errorMessage}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create Chat"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  )

  if (!isMobile) return body

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(o) => {
        if (!o && !isSubmitting) onCancel()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-label={`Create chat in ${stack.title}`}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex flex-col gap-3 rounded-t-2xl border-t border-border bg-card px-4 pt-5",
            "pb-[max(env(safe-area-inset-bottom),16px)]",
            "max-h-[85dvh] overflow-y-auto",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            "motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none"
          )}
        >
          <div className="mx-auto mb-1 h-1 w-9 rounded-full bg-border" aria-hidden />
          <DialogPrimitive.Title className="text-[15px] font-semibold leading-snug">
            New chat in {stack.title}
          </DialogPrimitive.Title>
          {body}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
