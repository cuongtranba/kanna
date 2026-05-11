import { type KeyboardEvent, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { Button } from "../../ui/button"
import { cn } from "../../../lib/utils"
import type { StackSummary, SidebarChatRow } from "../../../../shared/types"

interface StacksSectionProps {
  stacks: StackSummary[]
  projects: Array<{ id: string; title: string }>
  expandedStackIds: Set<string>
  onToggleExpanded: (stackId: string) => void
  onOpenCreatePanel: () => void
  onOpenStackMenu: (stackId: string) => void
  chats: SidebarChatRow[]
}

export function StacksSection({
  stacks,
  projects,
  expandedStackIds,
  onToggleExpanded,
  onOpenCreatePanel,
  onOpenStackMenu: _onOpenStackMenu,
  chats: _chats,
}: StacksSectionProps): ReactNode {
  const canCreateStack = projects.length >= 2

  function handleRowKeyDown(stackId: string, e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onToggleExpanded(stackId)
    }
  }

  return (
    <div className="flex flex-col">
      {/* Section header */}
      <div className="flex items-center justify-between px-2.5 py-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Stacks
        </span>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={!canCreateStack}
          title={canCreateStack ? undefined : "Register a second project to create a stack"}
          onClick={onOpenCreatePanel}
        >
          +
        </Button>
      </div>

      {/* Stack list or empty state */}
      {stacks.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-muted-foreground">
          A stack groups projects so one chat can read and write across them. Add your first stack.
        </p>
      ) : (
        <div className="flex flex-col">
          {stacks.map((stack) => {
            const isExpanded = expandedStackIds.has(stack.id)
            const memberProjects = projects.filter((p) => stack.projectIds.includes(p.id))

            return (
              <div key={stack.id}>
                {/* Stack row */}
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "group flex w-full items-center gap-2 pl-2.5 pr-0.5 py-0.5 rounded-lg text-left cursor-pointer",
                    "border-border/0 hover:border-border hover:bg-muted/20 active:scale-[0.985] border transition-all"
                  )}
                  onClick={() => onToggleExpanded(stack.id)}
                  onKeyDown={(e) => handleRowKeyDown(stack.id, e)}
                >
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                      isExpanded && "rotate-90"
                    )}
                  />
                  <span className="text-sm truncate flex-1">{stack.title}</span>
                  <span className="font-mono tabular-nums text-xs text-muted-foreground">
                    {stack.memberCount}
                  </span>
                </div>

                {/* Expanded member list */}
                {isExpanded && (
                  <div className="flex flex-col">
                    {memberProjects.map((project) => (
                      <div
                        key={project.id}
                        className="pl-5 py-0.5 text-xs text-muted-foreground"
                      >
                        {project.title}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
