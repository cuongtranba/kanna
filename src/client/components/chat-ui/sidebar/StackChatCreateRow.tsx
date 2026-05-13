import { useState, useCallback, type FormEvent, type KeyboardEvent, type ReactNode } from "react"
import { Button } from "../../ui/button"
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

  const [selectedWorktrees, setSelectedWorktrees] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>()
    for (const p of filteredProjects) {
      const primary = p.worktrees.find((w) => w.isPrimary) ?? p.worktrees[0]
      if (primary) map.set(p.id, primary.path)
    }
    return map
  })

  const [primaryProjectId, setPrimaryProjectId] = useState(filteredProjects[0]?.id ?? "")

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const stackBindings = filteredProjects.map((p) => ({
        projectId: p.id,
        worktreePath: selectedWorktrees.get(p.id) ?? p.worktrees[0]?.path ?? "",
        role: (p.id === primaryProjectId ? "primary" : "additional") as "primary" | "additional",
      }))
      await onCreate({ primaryProjectId, stackBindings })
    },
    [filteredProjects, selectedWorktrees, primaryProjectId, onCreate]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLFormElement>) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
      }
    },
    [onCancel]
  )

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-3 px-3 py-3 border border-border rounded-lg bg-card"
    >
      <ul className="flex flex-col divide-y divide-border -my-1">
        {filteredProjects.map((project) => {
          const selectedPath = selectedWorktrees.get(project.id) ?? project.worktrees[0]?.path ?? ""
          const isPrimary = project.id === primaryProjectId

          return (
            <li key={project.id} className="flex flex-col gap-1.5 py-2 min-w-0">
              <div className="flex items-baseline justify-between gap-2 min-w-0">
                <span className="text-[15px] font-semibold leading-snug truncate min-w-0">
                  {project.title}
                </span>
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
                className="w-full text-xs font-mono tabular-nums border border-border rounded-md px-2 py-1.5 bg-background text-foreground truncate"
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

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Create Chat
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
