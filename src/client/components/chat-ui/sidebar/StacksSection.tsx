import { type KeyboardEvent, type ReactNode } from "react"
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react"
import { Button } from "../../ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip"
import { cn } from "../../../lib/utils"
import type { StackSummary, SidebarChatRow } from "../../../../shared/types"

interface StacksSectionProps {
  stacks: StackSummary[]
  projects: Array<{ id: string; title: string }>
  expandedStackIds: Set<string>
  onToggleExpanded: (stackId: string) => void
  onOpenCreatePanel: () => void
  onOpenStackMenu: (stackId: string) => void
  onStartChat?: (stackId: string) => void
  renderChatCreate?: (stack: StackSummary) => ReactNode
  chats: SidebarChatRow[]
}

export function StacksSection({
  stacks,
  projects,
  expandedStackIds,
  onToggleExpanded,
  onOpenCreatePanel,
  onOpenStackMenu,
  onStartChat,
  renderChatCreate,
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
    <div className="flex flex-col mb-4">
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <span className="text-[13px] font-semibold text-foreground/70">
          Stacks
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              disabled={!canCreateStack}
              onClick={onOpenCreatePanel}
              className="size-6 rounded-md text-muted-foreground hover:text-foreground"
              aria-label="New stack"
            >
              <Plus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={4}>
            {canCreateStack ? "New stack" : "Register a second project to create a stack"}
          </TooltipContent>
        </Tooltip>
      </div>

      {stacks.length === 0 ? (
        <p className="px-2 pb-2 text-xs leading-relaxed text-muted-foreground">
          A stack groups projects so one chat can read and write across them. Add your first stack.
        </p>
      ) : (
        <div className="flex flex-col gap-px">
          {stacks.map((stack) => {
            const isExpanded = expandedStackIds.has(stack.id)
            const memberProjects = projects.filter((p) => stack.projectIds.includes(p.id))

            return (
              <div key={stack.id}>
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "group flex w-full items-center gap-2 pl-2 pr-1 py-1.5 rounded-md text-left cursor-pointer transition-colors duration-150",
                    "hover:bg-muted/40"
                  )}
                  onClick={() => onToggleExpanded(stack.id)}
                  onKeyDown={(e) => handleRowKeyDown(stack.id, e)}
                >
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                      isExpanded && "rotate-90"
                    )}
                  />
                  <span className="text-sm truncate flex-1 text-foreground">{stack.title}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground px-1.5 py-0.5 rounded bg-muted/60">
                    {stack.memberCount}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Stack actions"
                    className="size-6 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenStackMenu(stack.id)
                    }}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </div>

                {isExpanded && (
                  <div className="flex flex-col pt-0.5 pb-1">
                    {memberProjects.map((project) => (
                      <div
                        key={project.id}
                        className="pl-7 py-1 text-xs text-muted-foreground"
                      >
                        {project.title}
                      </div>
                    ))}
                    {onStartChat && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-7 mt-1 self-start h-6 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md"
                        onClick={(e) => {
                          e.stopPropagation()
                          onStartChat(stack.id)
                        }}
                      >
                        <Plus className="size-3" /> New chat
                      </Button>
                    )}
                    {renderChatCreate ? <div className="pl-7 pr-2 py-1">{renderChatCreate(stack)}</div> : null}
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
