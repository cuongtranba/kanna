import { memo, type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useMemo } from "react"
import { ChevronRight, GripVertical, MoreHorizontal, SquarePen, Star } from "lucide-react"
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type ClientRect,
  type CollisionDetection,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "../../ui/button"
import { Spinner } from "../../ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip"
import { HoverHint } from "../../ui/truncated-text"
import { AnimatePresence, MotionReveal } from "../../ui/motion-reveal"
import { MOTION_DURATION } from "../../../lib/motion"
import type { SidebarChatRow, SidebarProjectGroup } from "../../../../shared/types"
import { APP_NAME } from "../../../../shared/branding"
import { getPathBasename } from "../../../lib/formatters"
import { cn } from "../../../lib/utils"
import { ProjectSectionMenu } from "./Menus"
import { InstructionsDialog } from "./InstructionsDialog"
import { useKannaSidebarStore } from "../../../stores/kannaSidebarStore"
import { runPendingAction, usePendingAction } from "../../../stores/pendingActionsStore"
import {
  REORDER_PROJECT_GROUPS_KEY,
  createChatKey,
  projectActionKey,
  useProjectPending,
  type ProjectAction,
} from "./sidebarPendingActions"
import type { DomPort } from "../../../ports/domPort"
import { domAdapter } from "../../../adapters/dom.adapter"

interface Props {
  projectGroups: SidebarProjectGroup[]
  heading?: string
  editorLabel: string
  collapsedSections: Set<string>
  expandedGroups: Set<string>
  onToggleSection: (key: string) => void
  onToggleExpandedGroup: (key: string) => void
  renderChatRow: (chat: SidebarChatRow) => ReactNode
  onShowArchivedProject?: (projectId: string) => void
  onNewLocalChat?: (localPath: string) => Promise<void>
  onCopyPath?: (localPath: string) => Promise<void>
  onOpenExternalPath?: (action: "open_finder" | "open_editor", localPath: string) => Promise<void>
  onHideProject?: (projectId: string) => Promise<void>
  onOpenBoards?: (projectId: string) => void
  onToggleStar?: (projectId: string, starred: boolean) => Promise<void>
  onSetInstructions?: (projectId: string, instructions: string) => Promise<void>
  onReorderGroups?: (newOrder: string[]) => Promise<void>
  isConnected?: boolean
  startingLocalPath?: string | null
  dom?: DomPort
}

interface SortableProjectGroupProps {
  group: SidebarProjectGroup
  editorLabel: string
  collapsedSections: Set<string>
  expandedGroups: Set<string>
  onToggleSection: (key: string) => void
  onToggleExpandedGroup: (key: string) => void
  renderChatRow: (chat: SidebarChatRow) => ReactNode
  onShowArchivedProject?: (projectId: string) => void
  onNewLocalChat?: (localPath: string) => Promise<void>
  onCopyPath?: (localPath: string) => Promise<void>
  onOpenExternalPath?: (action: "open_finder" | "open_editor", localPath: string) => Promise<void>
  onHideProject?: (projectId: string) => Promise<void>
  onOpenBoards?: (projectId: string) => void
  onToggleStar?: (projectId: string, starred: boolean) => Promise<void>
  onSetInstructions?: (projectId: string, instructions: string) => Promise<void>
  isConnected?: boolean
  startingLocalPath?: string | null
  dom: DomPort
}

const DRAG_REORDER_TRIGGER_OFFSET_PX = 20

function openContextMenuFromButton(event: ReactMouseEvent<HTMLButtonElement>, dom: DomPort) {
  event.preventDefault()
  event.stopPropagation()
  const rect = event.currentTarget.getBoundingClientRect()
  dom.dispatchContextMenuEvent(event.currentTarget, rect.left + rect.width / 2, rect.bottom)
}

type RectLookup = {
  get(id: UniqueIdentifier): ClientRect | undefined
}

function getRectCenterY(rect: Pick<ClientRect, "top" | "height">) {
  return rect.top + rect.height / 2
}

function EmptyProjectChatButton({
  localPath,
  onNewLocalChat,
  isConnected,
  pending,
}: {
  localPath: string
  onNewLocalChat: (localPath: string) => void
  isConnected?: boolean
  pending: boolean
}) {
  const disabled = !isConnected || pending

  return (
    <HoverHint label={!isConnected ? `Start ${APP_NAME} to connect` : "New Chat"}>
    <button
      type="button"
      disabled={disabled}
      aria-busy={pending || undefined}
      className={cn(
        "group flex w-full items-center gap-2 pl-2 pr-1 py-1.5 rounded-md text-left cursor-pointer transition-colors duration-150",
        "hover:bg-muted/40",
        disabled && "cursor-not-allowed opacity-50"
      )}
      onClick={() => onNewLocalChat(localPath)}
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
        {pending ? <Spinner className="text-muted-foreground" /> : null}
      </span>
      <span className="text-sm truncate flex-1 text-muted-foreground italic">
        New Chat
      </span>
    </button>
    </HoverHint>
  )
}

export function getProjectGroupReorderPreviewTargetId({
  activeId,
  groupIds,
  collisionRect,
  droppableRects,
}: {
  activeId: string
  groupIds: string[]
  collisionRect: Pick<ClientRect, "top">
  droppableRects: RectLookup
}) {
  const activeIndex = groupIds.indexOf(activeId)
  if (activeIndex === -1) return null

  const activeRect = droppableRects.get(activeId)
  if (!activeRect) return null

  const previewTriggerY = collisionRect.top + DRAG_REORDER_TRIGGER_OFFSET_PX

  if (collisionRect.top > activeRect.top) {
    for (let index = groupIds.length - 1; index > activeIndex; index--) {
      const rect = droppableRects.get(groupIds[index])
      if (!rect) continue
      if (previewTriggerY >= getRectCenterY(rect)) {
        return groupIds[index]
      }
    }

    return activeId
  }

  if (collisionRect.top < activeRect.top) {
    for (let index = 0; index < activeIndex; index++) {
      const rect = droppableRects.get(groupIds[index])
      if (!rect) continue
      if (previewTriggerY <= getRectCenterY(rect)) {
        return groupIds[index]
      }
    }

    return activeId
  }

  return activeId
}

const SortableProjectGroup = memo(({
  group,
  editorLabel,
  collapsedSections,
  expandedGroups,
  onToggleSection,
  onToggleExpandedGroup,
  renderChatRow,
  onShowArchivedProject,
  onNewLocalChat,
  onCopyPath,
  onOpenExternalPath,
  onHideProject,
  onOpenBoards,
  onToggleStar,
  onSetInstructions,
  isConnected,
  startingLocalPath,
  dom,
}: SortableProjectGroupProps) => {
  const { groupKey, localPath } = group
  const isExpanded = expandedGroups.has(groupKey)
  const isEmptyProject = group.chats.length === 0
  const hasMore = group.olderChats.length > 0
  const cascadeCount = group.previewChats.length + (isExpanded ? group.olderChats.length : 0)
  const hasProjectMenu = Boolean(onHideProject && onCopyPath && onOpenExternalPath)
  const instructionsOpen = useKannaSidebarStore((s) => s.instructionsProjectId === groupKey)
  const setInstructionsProjectId = useKannaSidebarStore((s) => s.setInstructionsProjectId)

  const handleInstructionsOpenChange = useCallback(
    (open: boolean) => setInstructionsProjectId(open ? groupKey : null),
    [groupKey, setInstructionsProjectId],
  )
  const projectPending = useProjectPending(groupKey)
  const newChatPending = usePendingAction(createChatKey(groupKey)) || startingLocalPath === localPath
  const launch = useCallback((action: ProjectAction, run: () => Promise<void>) => {
    runPendingAction(projectActionKey(action, groupKey), run)
  }, [groupKey])
  const handleNewLocalChat = useCallback((path: string) => {
    if (!onNewLocalChat) return
    runPendingAction(createChatKey(groupKey), () => onNewLocalChat(path))
  }, [groupKey, onNewLocalChat])
  const handleSaveInstructions = useCallback((instructions: string) => {
    if (!onSetInstructions) return
    launch("project.setInstructions", () => onSetInstructions(groupKey, instructions))
  }, [groupKey, launch, onSetInstructions])

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: groupKey })

  const style = {
    transform: CSS.Translate.toString(transform ? { ...transform, x: 0 } : null),
    transition: isDragging ? undefined : transition,
  }

  const header = (
    <div
      aria-busy={projectPending || undefined}
      className={cn(
        "sticky top-0 bg-background dark:bg-card z-10 relative pl-2 pr-2 py-1 flex items-center gap-1 select-none",
        isDragging && "opacity-50"
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label="Drag to reorder project"
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 flex size-8 max-md:size-11 items-center justify-center rounded-sm text-muted-foreground/60 cursor-grab active:cursor-grabbing touch-none transition-opacity duration-150",
          "opacity-0 md:group-hover/section:opacity-100",
          isDragging && "opacity-100 cursor-grabbing"
        )}
        {...listeners}
        {...attributes}
      >
        <GripVertical className="size-3" />
      </button>
      <button
        type="button"
        onClick={() => onToggleSection(groupKey)}
        className="flex items-center gap-1.5 min-w-0 flex-1 rounded-md py-0.5 text-left hover:bg-muted/30 transition-colors duration-150"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-quick)] motion-reduce:transition-none",
            !collapsedSections.has(groupKey) && "rotate-90"
          )}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate min-w-0 text-13 font-semibold text-foreground/80">
              {getPathBasename(localPath)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={4}>
            {localPath}
          </TooltipContent>
        </Tooltip>
      </button>
      {group.starredAt !== undefined && (
        <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" />
      )}
      {(hasProjectMenu || onNewLocalChat) && (
        <div className={cn(
          "flex items-center gap-px opacity-100 md:group-hover/section:opacity-100 transition-opacity duration-150",
          projectPending || newChatPending ? "md:opacity-100" : "md:opacity-0",
        )}>
          {hasProjectMenu ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <ProjectSectionMenu
                  editorLabel={editorLabel}
                  starred={group.starredAt !== undefined}
                  onCopyPath={() => { if (onCopyPath) launch("project.copyPath", () => onCopyPath(localPath)) }}
                  onShowArchived={() => onShowArchivedProject?.(groupKey)}
                  onOpenInFinder={() => { if (onOpenExternalPath) launch("project.openFinder", () => onOpenExternalPath("open_finder", localPath)) }}
                  onOpenInEditor={() => { if (onOpenExternalPath) launch("project.openEditor", () => onOpenExternalPath("open_editor", localPath)) }}
                  onToggleStar={() => { if (onToggleStar) launch("project.setStar", () => onToggleStar(groupKey, group.starredAt === undefined)) }}
                  onEditInstructions={onSetInstructions ? () => setInstructionsProjectId(groupKey) : undefined}
                  onHide={() => { if (onHideProject) launch("project.remove", () => onHideProject(groupKey)) }}
                  onOpenBoards={onOpenBoards ? () => onOpenBoards(groupKey) : undefined}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-sm text-muted-foreground hover:text-foreground"
                    onClick={(event) => openContextMenuFromButton(event, dom)}
                    aria-label="Project options"
                    aria-busy={projectPending || undefined}
                  >
                    {projectPending ? <Spinner /> : <MoreHorizontal className="size-3.5" />}
                  </Button>
                </ProjectSectionMenu>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={4}>
                More
              </TooltipContent>
            </Tooltip>
          ) : null}
          {onNewLocalChat ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-8 rounded-sm text-muted-foreground hover:text-foreground",
                    !isConnected && "opacity-50 cursor-not-allowed"
                  )}
                  disabled={!isConnected}
                  pending={newChatPending}
                  onClick={(event) => {
                    event.stopPropagation()
                    handleNewLocalChat(localPath)
                  }}
                  aria-label="New chat in this project"
                >
                  <SquarePen className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={4}>
                {!isConnected ? `Start ${APP_NAME} to connect` : "New Chat"}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      )}
    </div>
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/section mb-3",
        isDragging && "opacity-50 shadow-lg z-50 relative"
      )}
    >
      {header}

      {onSetInstructions ? (
        <InstructionsDialog
          open={instructionsOpen}
          onOpenChange={handleInstructionsOpenChange}
          title={getPathBasename(localPath)}
          description="Conventions for this project. Every chat that can write it — including a stack chat rooted elsewhere — is told these."
          initialValue={group.instructions ?? ""}
          onSave={handleSaveInstructions}
        />
      ) : null}

      <AnimatePresence initial={false}>
        {!collapsedSections.has(groupKey) && (isEmptyProject ? Boolean(onNewLocalChat) : group.previewChats.length > 0 || hasMore) && (
          <div key="project-rows" className="flex flex-col gap-px pl-1">
            {isEmptyProject && onNewLocalChat ? (
              <EmptyProjectChatButton
                localPath={localPath}
                onNewLocalChat={handleNewLocalChat}
                isConnected={isConnected}
                pending={newChatPending}
              />
            ) : (
              <>
                {group.previewChats.map((chat, index) => (
                  <MotionReveal
                    key={chat._id}
                    index={index}
                    count={cascadeCount}
                    step={MOTION_DURATION.staggerRow}
                    y={-8}
                  >
                    {renderChatRow(chat)}
                  </MotionReveal>
                ))}
                {hasMore && isExpanded ? (
                  <button
                    onClick={() => onToggleExpandedGroup(groupKey)}
                    className="ml-6 mt-1 self-start px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded-md transition-colors duration-150"
                  >
                    Show less
                  </button>
                ) : null}
                {isExpanded ? group.olderChats.map((chat, index) => (
                  <MotionReveal
                    key={chat._id}
                    index={group.previewChats.length + index}
                    count={cascadeCount}
                    step={MOTION_DURATION.staggerRow}
                    y={-8}
                  >
                    {renderChatRow(chat)}
                  </MotionReveal>
                )) : null}
                {hasMore && !isExpanded ? (
                  <button
                    onClick={() => onToggleExpandedGroup(groupKey)}
                    className="ml-6 mt-1 self-start px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded-md transition-colors duration-150"
                  >
                    Show more
                  </button>
                ) : null}
              </>
            )}
          </div>
        )}
      </AnimatePresence>
    </div>
  )
})

function SectionHeading({ label, pending }: { label: string; pending: boolean }) {
  return (
    <div className="pl-2 pr-2 pt-2 pb-1 flex items-center gap-1" aria-busy={pending || undefined}>
      <span
        data-testid="sidebar-section-heading"
        className="flex-1 min-w-0 text-xs font-semibold tracking-wide text-muted-foreground"
      >
        {label}
      </span>
      {pending ? <Spinner className="text-muted-foreground" /> : null}
    </div>
  )
}

const LocalProjectsSectionImpl = function LocalProjectsSection({
  projectGroups,
  heading,
  editorLabel,
  collapsedSections,
  expandedGroups,
  onToggleSection,
  onToggleExpandedGroup,
  renderChatRow,
  onShowArchivedProject,
  onNewLocalChat,
  onCopyPath,
  onOpenExternalPath,
  onHideProject,
  onOpenBoards,
  onToggleStar,
  onSetInstructions,
  onReorderGroups,
  isConnected,
  startingLocalPath,
  dom: domProp,
}: Props) {
  const dom = domProp ?? domAdapter
  const reorderPending = usePendingAction(REORDER_PROJECT_GROUPS_KEY) && Boolean(onReorderGroups)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 2 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const groupIds = useMemo(
    () => projectGroups.map((g) => g.groupKey),
    [projectGroups]
  )

  const collisionDetection = useMemo<CollisionDetection>(() => (args) => {
    const overId = getProjectGroupReorderPreviewTargetId({
      activeId: String(args.active.id),
      groupIds,
      collisionRect: args.collisionRect,
      droppableRects: args.droppableRects,
    })

    if (!overId) {
      return closestCenter(args)
    }

    const overContainer = args.droppableContainers.find(
      (container) => container.id === overId
    )

    if (!overContainer) {
      return closestCenter(args)
    }

    return [
      {
        id: overContainer.id,
        data: {
          droppableContainer: overContainer,
          value: 0,
        },
      },
    ]
  }, [groupIds])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (over && active.id !== over.id && onReorderGroups) {
      const oldIndex = groupIds.indexOf(String(active.id))
      const newIndex = groupIds.indexOf(String(over.id))
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(groupIds, oldIndex, newIndex)
        runPendingAction(REORDER_PROJECT_GROUPS_KEY, () => onReorderGroups(newOrder))
      }
    }
  }

  return (
    <>
      {heading && projectGroups.length > 0 ? <SectionHeading label={heading} pending={reorderPending} /> : null}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={groupIds} strategy={verticalListSortingStrategy} disabled={reorderPending}>
          {projectGroups.map((group) => (
            <SortableProjectGroup
              key={group.groupKey}
              group={group}
              editorLabel={editorLabel}
              collapsedSections={collapsedSections}
              expandedGroups={expandedGroups}
              onToggleSection={onToggleSection}
              onToggleExpandedGroup={onToggleExpandedGroup}
              renderChatRow={renderChatRow}
              onShowArchivedProject={onShowArchivedProject}
              onNewLocalChat={onNewLocalChat}
              onCopyPath={onCopyPath}
              onOpenExternalPath={onOpenExternalPath}
              onHideProject={onHideProject}
              onOpenBoards={onOpenBoards}
              onToggleStar={onToggleStar}
              onSetInstructions={onSetInstructions}
              isConnected={isConnected}
              startingLocalPath={startingLocalPath}
              dom={dom}
            />
          ))}
        </SortableContext>
      </DndContext>
    </>
  )
}

export const LocalProjectsSection = memo(LocalProjectsSectionImpl)
