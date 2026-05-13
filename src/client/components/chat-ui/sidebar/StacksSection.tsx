import { type KeyboardEvent, type ReactNode } from "react"
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react"
import { Button } from "../../ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip"
import { cn } from "../../../lib/utils"
import { StackActionsPopover, StackSectionMenu } from "./Menus"
import type { StackSummary, SidebarChatRow } from "../../../../shared/types"

interface StacksSectionProps {
  stacks: StackSummary[]
  projects: Array<{ id: string; title: string }>
  expandedStackIds: Set<string>
  onToggleExpanded: (stackId: string) => void
  onOpenCreatePanel: () => void
  onOpenStackMenu: (stackId: string) => void
  onDeleteStack?: (stackId: string) => void
  onStartChat?: (stackId: string) => void
  renderChatCreate?: (stack: StackSummary) => ReactNode
  renderChatRow?: (chat: SidebarChatRow) => ReactNode
  chats: SidebarChatRow[]
}

export function StacksSection({
  stacks,
  projects,
  expandedStackIds,
  onToggleExpanded,
  onOpenCreatePanel,
  onOpenStackMenu,
  onDeleteStack,
  onStartChat,
  renderChatCreate,
  renderChatRow,
  chats,
}: StacksSectionProps): ReactNode {
  const canCreateStack = projects.length >= 2

  const chatsByStackId = new Map<string, SidebarChatRow[]>()
  for (const chat of chats) {
    if (!chat.stackId) continue
    const existing = chatsByStackId.get(chat.stackId)
    if (existing) existing.push(chat)
    else chatsByStackId.set(chat.stackId, [chat])
  }

  function handleRowKeyDown(stackId: string, e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onToggleExpanded(stackId)
    }
  }

  return (
    <div className="flex flex-col mb-3">
      <div className="pl-2 pr-2 pt-2 pb-1 flex items-center gap-1">
        <span className="flex-1 min-w-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
        <p className="pl-2 pr-2 pb-2 text-xs leading-relaxed text-muted-foreground">
          A stack groups projects so one chat can read and write across them. Add your first stack.
        </p>
      ) : (
        <div className="flex flex-col gap-px">
          {stacks.map((stack) => {
            const isExpanded = expandedStackIds.has(stack.id)
            const memberProjects = projects.filter((p) => stack.projectIds.includes(p.id))

            const headerRow = (
              <div className="group/section pl-2 pr-2 py-1 flex items-center gap-1 select-none">
                <div
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-1.5 min-w-0 flex-1 rounded-md py-0.5 text-left hover:bg-muted/30 transition-colors duration-150 cursor-pointer"
                  onClick={() => onToggleExpanded(stack.id)}
                  onKeyDown={(e) => handleRowKeyDown(stack.id, e)}
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                      isExpanded && "rotate-90"
                    )}
                  />
                  <span className="truncate min-w-0 text-[13px] font-semibold text-foreground/80">
                    {stack.title}
                  </span>
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground px-1.5 py-0.5 rounded bg-muted/60 shrink-0">
                  {stack.memberCount}
                </span>
                {onDeleteStack ? (
                  <StackActionsPopover
                    stackTitle={stack.title}
                    onRename={() => onOpenStackMenu(stack.id)}
                    onEditMembers={() => onOpenStackMenu(stack.id)}
                    onDelete={() => onDeleteStack(stack.id)}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Stack actions"
                      className="size-6 rounded-sm opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity duration-150"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </StackActionsPopover>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Stack actions"
                    className="size-6 rounded-sm opacity-0 group-hover/section:opacity-100 transition-opacity duration-150"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenStackMenu(stack.id)
                    }}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                )}
              </div>
            )

            return (
              <div key={stack.id}>
                {onDeleteStack ? (
                  <StackSectionMenu
                    stackTitle={stack.title}
                    onRename={() => onOpenStackMenu(stack.id)}
                    onEditMembers={() => onOpenStackMenu(stack.id)}
                    onDelete={() => onDeleteStack(stack.id)}
                  >
                    {headerRow}
                  </StackSectionMenu>
                ) : (
                  headerRow
                )}

                {isExpanded && (
                  <div className="flex flex-col gap-px pb-1">
                    {memberProjects.map((project) => (
                      <div
                        key={project.id}
                        className="pl-[28px] pr-2 py-1 text-[13px] text-muted-foreground truncate"
                      >
                        {project.title}
                      </div>
                    ))}
                    {renderChatRow && (chatsByStackId.get(stack.id) ?? []).length > 0 && (
                      <div className="flex flex-col mt-0.5 pl-1">
                        {(chatsByStackId.get(stack.id) ?? []).map((chat) => renderChatRow(chat))}
                      </div>
                    )}
                    {onStartChat && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-[28px] mt-1 self-start h-6 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md"
                        onClick={(e) => {
                          e.stopPropagation()
                          onStartChat(stack.id)
                        }}
                      >
                        <Plus className="size-3" /> New chat
                      </Button>
                    )}
                    {renderChatCreate ? <div className="pl-[28px] pr-2 py-1">{renderChatCreate(stack)}</div> : null}
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
