import { LegendList, type LegendListRef } from "@legendapp/list/react"
import { PatchDiff } from "@pierre/diffs/react"
import { AlertTriangle, ArrowUp, Ban, Building2, Check, ChevronDown, ChevronUp, Code, Columns2, Copy, Download, Ellipsis, FileText, FolderOpen, GitBranch, GitBranchPlus, Github, GitMerge, GitPullRequest, Globe, LoaderCircle, Lock, Minus, PencilLine, PenLine, RefreshCw, Rows3, Search, Trash2, Upload, UserRound, WrapText } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react"
import type {
  ChatAttachment,
  ChatBranchHistoryEntry,
  ChatBranchListEntry,
  ChatBranchListResult,
  ChatDiffSnapshot,
  DiffCommitMode,
  DiffCommitResult,
  ChatMergeBranchResult,
  ChatMergePreviewResult,
  GitHubPublishInfo,
  GitHubRepoAvailabilityResult,
} from "../../../shared/types"
import { isRecord } from "../../../shared/errors"
import { useStickyState } from "../../hooks/useStickyState"
import { cn } from "../../lib/utils"
import { useDiffCommitStore } from "../../stores/diffCommitStore"
import { useRightSidebarStore } from "../../stores/rightSidebarStore"
import { useRightSidebarUiStore } from "../../stores/rightSidebarUiStore"
import { DiffFileCardStore } from "./DiffFileCard.store"
import { AttachmentFileCard, AttachmentImageCard } from "../messages/AttachmentCard"
import { FilePreviewSheet } from "../messages/file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment } from "../messages/file-preview/types"
import { classifyAttachmentPreview } from "../messages/attachmentPreview"
import { Button } from "../ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "../ui/context-menu"
import { Input } from "../ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { SegmentedControl } from "../ui/segmented-control"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { Textarea } from "../ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../ui/dialog"

type DiffRenderMode = "unified" | "split"
type DiffFile = ChatDiffSnapshot["files"][number]
type SidebarViewMode = "changes" | "history"
type RepoVisibility = "public" | "private"
type EntryView = "branches" | "pull_requests"
const SIDEBAR_VIEW_MODES = new Set<string>(["changes", "history"] satisfies SidebarViewMode[])
const REPO_VISIBILITY_VALUES = new Set<string>(["public", "private"] satisfies RepoVisibility[])
const ENTRY_VIEW_VALUES = new Set<string>(["branches", "pull_requests"] satisfies EntryView[])
function isSidebarViewMode(v: string): v is SidebarViewMode { return SIDEBAR_VIEW_MODES.has(v) }
function isRepoVisibility(v: string): v is RepoVisibility { return REPO_VISIBILITY_VALUES.has(v) }
function isEntryView(v: string): v is EntryView { return ENTRY_VIEW_VALUES.has(v) }
const EMPTY_CHECKED_PATHS: Record<string, boolean> = {}

export function shouldLoadDiffPatchNow(args: {
  isCollapsed: boolean
  hasPreviewAttachment: boolean
  patch?: string
  patchError?: string
  isPatchLoading: boolean
}) {
  return !args.isCollapsed
    && !args.hasPreviewAttachment
    && args.patch === undefined
    && args.patchError === undefined
    && !args.isPatchLoading
}

function getDiffPreviewAttachment(projectId: string | null, file: DiffFile): ChatAttachment | null {
  if (!projectId || !file.mimeType || typeof file.size !== "number" || file.changeType === "deleted") {
    return null
  }

  if (!file.mimeType.startsWith("image/") && file.mimeType !== "application/pdf") {
    return null
  }

  return {
    id: `diff:${file.path}`,
    kind: file.mimeType.startsWith("image/") ? "image" : "file",
    displayName: file.path.split("/").pop() ?? file.path,
    absolutePath: file.path,
    relativePath: file.path,
    contentUrl: `/api/projects/${projectId}/files/${encodeURIComponent(file.path)}/content`,
    mimeType: file.mimeType,
    size: file.size,
  }
}

export interface DiffFileActions {
  onOpenFile: (path: string) => void
  onOpenInFinder: (path: string) => void
  onDiscardFile: (path: string) => void
  onIgnoreFile: (path: string) => void
  onIgnoreFolder: (path: string) => void
  onCopyFilePath: (path: string) => void
  onCopyRelativePath: (path: string) => void
}

interface RightSidebarProps extends DiffFileActions {
  projectId: string | null
  diffs: ChatDiffSnapshot
  editorLabel: string
  diffRenderMode: DiffRenderMode
  wrapLines: boolean
  onLoadPatch: (path: string) => Promise<string>
  onListBranches: () => Promise<ChatBranchListResult>
  onPreviewMergeBranch: (branch: ChatBranchListEntry) => Promise<ChatMergePreviewResult>
  onMergeBranch: (branch: ChatBranchListEntry) => Promise<ChatMergeBranchResult | null>
  onCheckoutBranch: (branch: ChatBranchListEntry) => Promise<void>
  onCreateBranch: () => Promise<void>
  onGenerateCommitMessage: (args: { paths: string[] }) => Promise<{ subject: string; body: string }>
  onInitializeGit: () => Promise<unknown>
  onGetGitHubPublishInfo: () => Promise<GitHubPublishInfo>
  onCheckGitHubRepoAvailability: (args: { owner: string; name: string }) => Promise<GitHubRepoAvailabilityResult>
  onSetupGitHub: (args: { owner: string; name: string; visibility: "public" | "private"; description: string }) => Promise<unknown>
  onCommit: (args: { paths: string[]; summary: string; description: string; mode: DiffCommitMode }) => Promise<DiffCommitResult | null>
  onSyncWithRemote: (action: "fetch" | "pull" | "push" | "publish") => Promise<unknown>
  onDiffRenderModeChange: (mode: DiffRenderMode) => void
  onWrapLinesChange: (wrap: boolean) => void
}

export function canIgnoreDiffFile(file: DiffFile) {
  return file.isUntracked
}

export function canIgnoreDiffFolder(file: DiffFile) {
  if (!canIgnoreDiffFile(file)) {
    return false
  }
  return file.path.includes("/")
}

function IconButton(props: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={props.label}
          title={props.label}
          onClick={props.onClick}
          className={cn(
            "flex h-11 w-11 md:h-7 md:w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            props.active && "bg-accent text-foreground"
          )}
        >
          {props.children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function StageCheckbox({
  checked,
  mixed = false,
  label,
  className,
  onClick,
}: {
  checked: boolean
  mixed?: boolean
  label?: string
  className?: string
  onClick: () => void
}) {
  let checkboxIcon: ReactNode
  if (mixed) {
    checkboxIcon = <Minus className="h-3 w-3" strokeWidth={3} />
  } else if (checked) {
    checkboxIcon = <Check className="h-3 w-3" strokeWidth={3} />
  } else {
    checkboxIcon = null
  }
  return (
    <button
      type="button"
      aria-label={label ?? (checked ? "Exclude file from commit" : "Include file in commit")}
      aria-checked={mixed ? "mixed" : checked}
      aria-pressed={mixed ? "mixed" : checked}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex size-4.5 shrink-0 items-center justify-center rounded border transition-colors",
        checked || mixed
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-transparent",
        className
      )}
    >
      {checkboxIcon}
    </button>
  )
}

function formatRelativeTime(isoTimestamp: string) {
  const timestamp = Date.parse(isoTimestamp)
  if (!Number.isFinite(timestamp)) {
    return ""
  }

  const diffMs = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  const month = 30 * day
  const year = 365 * day

  if (diffMs < minute) {
    return "just now"
  }
  if (diffMs < hour) {
    return `${Math.round(diffMs / minute)}m ago`
  }
  if (diffMs < day) {
    return `${Math.round(diffMs / hour)}hr ago`
  }
  if (diffMs < week) {
    return `${Math.round(diffMs / day)}d ago`
  }
  if (diffMs < month) {
    return `${Math.round(diffMs / week)}wk ago`
  }
  if (diffMs < year) {
    return `${Math.round(diffMs / month)}mo ago`
  }
  return `${Math.round(diffMs / year)}yr ago`
}

function formatFetchTooltip(isoTimestamp?: string) {
  if (!isoTimestamp) {
    return "No local fetch recorded"
  }
  return `Last fetched ${formatRelativeTime(isoTimestamp)}`
}

function CommitHistoryRow({ entry, isPendingPush = false }: { entry: ChatBranchHistoryEntry; isPendingPush?: boolean }) {
  const relativeTime = formatRelativeTime(entry.authoredAt)
  const isClickable = Boolean(entry.githubUrl)
  let tagSection: ReactNode
  if (entry.tags.length > 0) {
    tagSection = (
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {entry.tags.map((tag) => (
          <span key={tag} className="inline-flex items-center rounded-full bg-muted border border-border  px-2 py-0.5 text-[11px]">
            {tag}
          </span>
        ))}
        {isPendingPush ? (
          <span className="inline-flex items-center rounded-full bg-muted border border-border  px-2 py-0.5 text-[11px]">
            <ArrowUp className="size-3" />
          </span>
        ) : null}
      </div>
    )
  } else if (isPendingPush) {
    tagSection = (
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        <span className="inline-flex items-center rounded-full bg-muted border border-border  px-2 py-0.5 text-[11px]">
          <ArrowUp className="size-3" />
        </span>
      </div>
    )
  } else {
    tagSection = null
  }
  return (
    <button
      type="button"
      disabled={!isClickable}
      onClick={() => {
        if (!entry.githubUrl || typeof window === "undefined") return
        window.open(entry.githubUrl, "_blank", "noopener,noreferrer")
      }}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border border-border bg-background pl-3 pr-2 py-2 text-left transition-colors",
        isClickable ? "hover:bg-accent" : "cursor-default opacity-60"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{entry.summary}</div>
        {entry.description ? (
          <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
            {entry.description}
          </div>
        ) : null}
        <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {entry.authorName ? <span className="truncate">{entry.authorName}</span> : null}
          {entry.authorName && relativeTime ? <span aria-hidden="true">•</span> : null}
          {relativeTime ? <span>{relativeTime}</span> : null}
        </div>
      </div>
      {tagSection}
    </button>
  )
}

function getBranchCandidatePriority(entry: ChatBranchListEntry) {
  switch (entry.kind) {
    case "local":
      return 0
    case "pull_request":
      return 1
    case "remote":
    default:
      return 2
  }
}

function dedupeBranchEntries(entries: ChatBranchListEntry[]) {
  const selectedByName = new Map<string, ChatBranchListEntry>()
  for (const entry of entries) {
    const existing = selectedByName.get(entry.name)
    if (!existing || getBranchCandidatePriority(entry) < getBranchCandidatePriority(existing)) {
      selectedByName.set(entry.name, entry)
    }
  }
  return selectedByName
}

function getMergeBranchGroups(branchList: ChatBranchListResult, currentBranchName?: string) {
  const uniqueEntriesByName = dedupeBranchEntries([
    ...branchList.local,
    ...branchList.pullRequests,
    ...branchList.remote,
  ])
  if (currentBranchName) {
    uniqueEntriesByName.delete(currentBranchName)
  }

  const usedNames = new Set<string>()
  const defaultBranch = branchList.defaultBranchName
    ? uniqueEntriesByName.get(branchList.defaultBranchName)
    : undefined

  if (defaultBranch) {
    usedNames.add(defaultBranch.name)
  }

  const recent = branchList.recent
    .map((entry) => uniqueEntriesByName.get(entry.name) ?? entry)
    .filter((entry): entry is ChatBranchListEntry => Boolean(entry) && !usedNames.has(entry.name))

  for (const entry of recent) {
    usedNames.add(entry.name)
  }

  const other = [...uniqueEntriesByName.values()]
    .filter((entry) => !usedNames.has(entry.name))
    .sort((left, right) => left.displayName.localeCompare(right.displayName))

  return {
    defaultBranch,
    recent,
    other,
  }
}

function GitHubPublishModal({
  open,
  onOpenChange,
  onGetGitHubPublishInfo,
  onCheckGitHubRepoAvailability,
  onPublish,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGetGitHubPublishInfo: () => Promise<GitHubPublishInfo>
  onCheckGitHubRepoAvailability: (args: { owner: string; name: string }) => Promise<GitHubRepoAvailabilityResult>
  onPublish: (args: { owner: string; name: string; visibility: "public" | "private"; description: string }) => Promise<unknown>
}) {
  const info = useRightSidebarUiStore((store) => store.publishInfo)
  const isLoadingInfo = useRightSidebarUiStore((store) => store.isLoadingPublishInfo)
  const owner = useRightSidebarUiStore((store) => store.publishOwner)
  const name = useRightSidebarUiStore((store) => store.publishName)
  const visibility = useRightSidebarUiStore((store) => store.publishVisibility)
  const description = useRightSidebarUiStore((store) => store.publishDescription)
  const availability = useRightSidebarUiStore((store) => store.publishAvailability)
  const isCheckingAvailability = useRightSidebarUiStore((store) => store.isCheckingPublishAvailability)
  const isPublishing = useRightSidebarUiStore((store) => store.isPublishing)
  const setInfo = useRightSidebarUiStore((store) => store.setPublishInfo)
  const setIsLoadingInfo = useRightSidebarUiStore((store) => store.setIsLoadingPublishInfo)
  const setOwner = useRightSidebarUiStore((store) => store.setPublishOwner)
  const setName = useRightSidebarUiStore((store) => store.setPublishName)
  const setVisibility = useRightSidebarUiStore((store) => store.setPublishVisibility)
  const setDescription = useRightSidebarUiStore((store) => store.setPublishDescription)
  const setAvailability = useRightSidebarUiStore((store) => store.setPublishAvailability)
  const setIsCheckingAvailability = useRightSidebarUiStore((store) => store.setIsCheckingPublishAvailability)
  const setIsPublishing = useRightSidebarUiStore((store) => store.setIsPublishing)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setIsLoadingInfo(true)
    setAvailability(null)
    void onGetGitHubPublishInfo()
      .then((result) => {
        if (cancelled) return
        setInfo(result)
        setOwner(result.owners[0] ?? result.activeAccountLogin ?? "")
        setName(result.suggestedRepoName)
        setVisibility("private")
        setDescription("")
      })
      .finally(() => {
        if (cancelled) return
        setIsLoadingInfo(false)
      })
    return () => {
      cancelled = true
    }
  }, [onGetGitHubPublishInfo, open, setAvailability, setDescription, setInfo, setIsLoadingInfo, setName, setOwner, setVisibility])

  useEffect(() => {
    if (!open || !info?.ghInstalled || !info.authenticated) {
      return
    }
    const trimmedOwner = owner.trim()
    const trimmedName = name.trim()
    if (!trimmedOwner || !trimmedName) {
      setAvailability(null)
      return
    }

    let cancelled = false
    setIsCheckingAvailability(true)
    const timeoutId = window.setTimeout(() => {
      void onCheckGitHubRepoAvailability({ owner: trimmedOwner, name: trimmedName })
        .then((result) => {
          if (cancelled) return
          setAvailability(result)
        })
        .finally(() => {
          if (cancelled) return
          setIsCheckingAvailability(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [info?.authenticated, info?.ghInstalled, name, onCheckGitHubRepoAvailability, open, owner, setAvailability, setIsCheckingAvailability])

  async function handlePublish() {
    if (!owner.trim() || !name.trim()) return
    setIsPublishing(true)
    try {
      const result = await onPublish({
        owner: owner.trim(),
        name: name.trim(),
        visibility,
        description,
      })
      if (isRecord(result) && result.ok) {
        onOpenChange(false)
      }
    } finally {
      setIsPublishing(false)
    }
  }

  const canPublish = Boolean(
    info?.ghInstalled
    && info.authenticated
    && owner.trim()
    && name.trim()
    && availability?.available
    && !isCheckingAvailability
    && !isPublishing
  )

  let availabilityIndicator: ReactNode
  if (isCheckingAvailability) {
    availabilityIndicator = (
      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
      </div>
    )
  } else if (availability) {
    availabilityIndicator = (
      <div className="absolute inset-y-0 right-2 flex items-center">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label={availability.message}
              className={cn(
                "flex size-6 items-center justify-center rounded-md",
                availability.available
                  ? "text-success"
                  : "text-destructive"
              )}
            >
              {availability.available ? <Check className="size-4" /> : <AlertTriangle className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{availability.message}</TooltipContent>
        </Tooltip>
      </div>
    )
  } else {
    availabilityIndicator = null
  }

  let infoContent: ReactNode
  if (isLoadingInfo) {
    infoContent = (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        <span>Checking GitHub CLI…</span>
      </div>
    )
  } else if (info && !info.ghInstalled) {
    infoContent = (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>GitHub CLI is not installed.</p>
        <div className="rounded-lg border border-border px-3 py-2 font-mono text-xs text-foreground">
          brew install gh
        </div>
        <p>Then run:</p>
        <div className="rounded-lg border border-border px-3 py-2 font-mono text-xs text-foreground">
          gh auth login
        </div>
      </div>
    )
  } else if (info && !info.authenticated) {
    infoContent = (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>GitHub CLI is installed but not signed in.</p>
        <div className="rounded-lg border border-border px-3 py-2 font-mono text-xs text-foreground">
          gh auth login
        </div>
      </div>
    )
  } else {
    infoContent = (
      <>
        <div className="space-y-2">
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="pl-[11px] [&>span]:flex [&>span]:items-center [&>span]:gap-2">
              <SelectValue placeholder="Select owner" />
            </SelectTrigger>
            <SelectContent>
              {(info?.owners ?? []).map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  <span className="flex items-center gap-2">
                    {candidate === info?.activeAccountLogin ? (
                      <UserRound className="size-4 text-muted-foreground" />
                    ) : (
                      <Building2 className="size-4 text-muted-foreground" />
                    )}
                    <span className="pl-[1px]">{candidate}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <div className="relative">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-repo"
              className="pl-9 pr-10"
            />
            <PencilLine className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-muted-foreground" />
            {availabilityIndicator}
          </div>
        </div>
        <div className="space-y-2">
          <div className="relative">
            <FileText className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="Optional description"
              className="pl-9 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Select value={visibility} onValueChange={(value) => { if (isRepoVisibility(value)) setVisibility(value) }}>
            <SelectTrigger className="pl-[11px] [&>span]:flex [&>span]:items-center [&>span]:gap-2">
              <SelectValue placeholder="Select visibility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">
                <span className="flex items-center gap-2">
                  <Lock className="size-4 text-muted-foreground" />
                  <span className="pl-[1px]">Private</span>
                </span>
              </SelectItem>
              <SelectItem value="public">
                <span className="flex items-center gap-2">
                  <Globe className="size-4 text-muted-foreground" />
                  <span className="pl-[1px]">Public</span>
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" className="max-w-[min(92vw,475px)]">
        <DialogBody className="space-y-2 px-4 pb-4 pt-4">
          <div className="space-y-1">
            <DialogTitle>Push to GitHub</DialogTitle>
            <DialogDescription>Create a GitHub repository from this local project using GitHub CLI.</DialogDescription>
          </div>
          {infoContent}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canPublish} onClick={() => void handlePublish()}>
            {isPublishing ? (
              <>
                <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                Publishing…
              </>
            ) : (
              "Push to GitHub"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BranchSearchInput({
  value,
  onChange,
  placeholder,
  disabled,
  trailingAction,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
  trailingAction?: ReactNode
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn("h-9 pl-7 text-sm", trailingAction ? "pr-14" : undefined)}
        disabled={disabled}
      />
      {trailingAction ? <div className="absolute right-1 top-1/2 -translate-y-1/2">{trailingAction}</div> : null}
    </div>
  )
}

function BranchListSection({
  title,
  entries,
  emptyLabel,
  selectedName,
  disabled,
  stickyTitle = false,
  onSelect,
}: {
  title: string
  entries: ChatBranchListEntry[]
  emptyLabel?: string
  selectedName?: string | null
  disabled?: boolean
  stickyTitle?: boolean
  onSelect: (entry: ChatBranchListEntry) => void
}) {
  if (entries.length === 0 && !emptyLabel) {
    return null
  }

  return (
    <div className="space-y-1">
      <div className={cn(
        "px-1 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
        stickyTitle && "sticky top-0 z-10 bg-background"
      )}>
        {title}
      </div>
      {entries.length === 0 ? (
        <div className="px-1 py-1 text-xs text-muted-foreground">{emptyLabel}</div>
      ) : (
        entries.map((entry) => {
          const isSelected = selectedName === entry.name
          return (
            <button
              key={entry.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(entry)}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-60",
                isSelected
                  ? "bg-accent text-foreground"
                  : "hover:bg-accent"
              )}
            >
              {entry.kind === "pull_request"
                ? <GitPullRequest className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                : <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <div className="flex w-full items-center gap-3">
                  <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm text-foreground">{entry.displayName}</div>
                  {entry.updatedAt ? (
                    <div className="ml-auto shrink-0 text-right text-[11px] text-muted-foreground">
                      {formatRelativeTime(entry.updatedAt)}
                    </div>
                  ) : null}
                </div>
                {(entry.kind === "pull_request" && entry.description) || entry.headLabel ? (
                  <div className="truncate text-xs text-muted-foreground">
                    {entry.kind === "pull_request" ? (entry.description ?? entry.headLabel ?? entry.name) : (entry.headLabel ?? undefined)}
                  </div>
                ) : null}
              </div>
            </button>
          )
        })
      )}
    </div>
  )
}

function MergeBranchModal({
  open,
  onOpenChange,
  branchList,
  currentBranchName,
  onPreviewMergeBranch,
  onMergeBranch,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchList: ChatBranchListResult | null
  currentBranchName?: string
  onPreviewMergeBranch: (branch: ChatBranchListEntry) => Promise<ChatMergePreviewResult>
  onMergeBranch: (branch: ChatBranchListEntry) => Promise<ChatMergeBranchResult | null>
}) {
  const query = useRightSidebarUiStore((store) => store.mergeBranchQuery)
  const selectedName = useRightSidebarUiStore((store) => store.mergeBranchSelectedName)
  const preview = useRightSidebarUiStore((store) => store.mergePreview)
  const previewError = useRightSidebarUiStore((store) => store.mergePreviewError)
  const isPreviewLoading = useRightSidebarUiStore((store) => store.isMergePreviewLoading)
  const isMerging = useRightSidebarUiStore((store) => store.isMergeBranching)
  const setQuery = useRightSidebarUiStore((store) => store.setMergeBranchQuery)
  const setSelectedName = useRightSidebarUiStore((store) => store.setMergeBranchSelectedName)
  const setPreview = useRightSidebarUiStore((store) => store.setMergePreview)
  const setPreviewError = useRightSidebarUiStore((store) => store.setMergePreviewError)
  const setIsPreviewLoading = useRightSidebarUiStore((store) => store.setIsMergePreviewLoading)
  const setIsMerging = useRightSidebarUiStore((store) => store.setIsMergeBranching)
  const resetMergeBranchModal = useRightSidebarUiStore((store) => store.resetMergeBranchModal)
  const resetMergePreview = useRightSidebarUiStore((store) => store.resetMergePreview)

  const groupedEntries = useMemo(() => {
    if (!branchList) {
      return { defaultBranch: undefined, recent: [], other: [] }
    }
    return getMergeBranchGroups(branchList, currentBranchName)
  }, [branchList, currentBranchName])

  const normalizedQuery = query.trim().toLowerCase()
  const matchesQuery = useCallback((entry: ChatBranchListEntry) => {
    if (!normalizedQuery) return true
    return [
      entry.displayName,
      entry.name,
      entry.description,
      entry.prTitle,
      entry.headLabel,
    ].some((value) => value?.toLowerCase().includes(normalizedQuery))
  }, [normalizedQuery])

  const visibleDefaultBranch = groupedEntries.defaultBranch && matchesQuery(groupedEntries.defaultBranch)
    ? groupedEntries.defaultBranch
    : undefined
  const visibleRecent = groupedEntries.recent.filter(matchesQuery)
  const visibleOther = groupedEntries.other.filter(matchesQuery)

  const selectedEntry = useMemo(() => {
    if (!selectedName) return null
    return [groupedEntries.defaultBranch, ...groupedEntries.recent, ...groupedEntries.other]
      .find((entry): entry is ChatBranchListEntry => entry !== undefined && entry.name === selectedName) ?? null
  }, [groupedEntries.defaultBranch, groupedEntries.other, groupedEntries.recent, selectedName])

  useEffect(() => {
    if (!open) {
      resetMergeBranchModal()
    }
  }, [open, resetMergeBranchModal])

  useEffect(() => {
    if (!open || !selectedEntry) {
      resetMergePreview()
      return
    }

    let cancelled = false
    setPreview(null)
    setPreviewError(null)
    setIsPreviewLoading(true)

    void onPreviewMergeBranch(selectedEntry)
      .then((result) => {
        if (cancelled) return
        setPreview(result)
      })
      .catch((error) => {
        if (cancelled) return
        setPreviewError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (cancelled) return
        setIsPreviewLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [onPreviewMergeBranch, open, resetMergePreview, selectedEntry, setIsPreviewLoading, setPreview, setPreviewError])

  const mergeDisabled = !selectedEntry || !preview || isPreviewLoading || isMerging || preview.status !== "mergeable"

  async function handleMerge() {
    if (!selectedEntry || mergeDisabled) return
    setIsMerging(true)
    try {
      const result = await onMergeBranch(selectedEntry)
      if (result?.ok) {
        onOpenChange(false)
      }
    } finally {
      setIsMerging(false)
    }
  }

  let previewStatusIcon: ReactNode
  if (preview) {
    if (preview.status === "up_to_date") {
      previewStatusIcon = <Check className="mt-1 size-3.5 shrink-0 text-success" />
    } else if (preview.status === "conflicts") {
      previewStatusIcon = <AlertTriangle className="mt-1 size-3.5 shrink-0 text-warning" />
    } else if (preview.status === "mergeable") {
      previewStatusIcon = <GitBranchPlus className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
    } else {
      previewStatusIcon = <AlertTriangle className="mt-1 size-3.5 shrink-0 text-destructive" />
    }
  } else {
    previewStatusIcon = null
  }

  let mergePreviewContent: ReactNode
  if (!selectedEntry) {
    mergePreviewContent = (
      <div className="text-sm text-muted-foreground">
        Select a branch to preview the merge.
      </div>
    )
  } else if (isPreviewLoading) {
    mergePreviewContent = (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        <span>Checking merge preview…</span>
      </div>
    )
  } else if (previewError) {
    mergePreviewContent = (
      <div className="text-sm text-destructive">
        {previewError}
      </div>
    )
  } else if (preview) {
    mergePreviewContent = (
      <div className="flex items-start gap-2">
        {previewStatusIcon}
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-medium text-foreground">{preview.message}</div>
          {preview.detail ? (
            <div className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{preview.detail}</div>
          ) : null}
        </div>
      </div>
    )
  } else {
    mergePreviewContent = (
      <div className="text-sm text-muted-foreground">
        Preview unavailable.
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" className="max-w-[min(92vw,475px)]">
        <DialogBody className="flex min-h-0 flex-col gap-3 px-4 pb-4 pt-4">
          <div className="space-y-1">
            <DialogTitle>Merge into {currentBranchName ?? "current branch"}</DialogTitle>
            <DialogDescription>
              Choose a branch to continue.
            </DialogDescription>
          </div>
          <BranchSearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search branches"
          />
          <div className="max-h-[375px] space-y-3 overflow-y-auto pr-1">
            <BranchListSection
              title="Default Branch"
              entries={visibleDefaultBranch ? [visibleDefaultBranch] : []}
              emptyLabel="No default branch available."
              selectedName={selectedName}
              onSelect={(entry) => setSelectedName(entry.name)}
            />
            <BranchListSection
              title="Recent Branches"
              entries={visibleRecent}
              emptyLabel="No recent branches."
              selectedName={selectedName}
              onSelect={(entry) => setSelectedName(entry.name)}
            />
            <BranchListSection
              title="Other Branches"
              entries={visibleOther}
              emptyLabel="No other branches match this search."
              selectedName={selectedName}
              onSelect={(entry) => setSelectedName(entry.name)}
            />
          </div>
          <div className="px-2">
            {mergePreviewContent}
          </div>
        </DialogBody>
        <DialogFooter>
          <div className="flex min-w-0 w-full items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="max-w-full min-w-0" size="sm" disabled={mergeDisabled} onClick={() => void handleMerge()}>
              {isMerging ? (
                <>
                  <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Merging…
                </>
              ) : (
                <span className="block max-w-full truncate">Merge</span>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BranchSwitcher({
  currentBranchName,
  onListBranches,
  onPreviewMergeBranch,
  onMergeBranch,
  onCheckoutBranch,
  onCreateBranch,
}: {
  currentBranchName?: string
  onListBranches: () => Promise<ChatBranchListResult>
  onPreviewMergeBranch: (branch: ChatBranchListEntry) => Promise<ChatMergePreviewResult>
  onMergeBranch: (branch: ChatBranchListEntry) => Promise<ChatMergeBranchResult | null>
  onCheckoutBranch: (branch: ChatBranchListEntry) => Promise<void>
  onCreateBranch: () => Promise<void>
}) {
  const open = useRightSidebarUiStore((store) => store.branchSwitcherOpen)
  const mergeModalOpen = useRightSidebarUiStore((store) => store.mergeModalOpen)
  const isLoading = useRightSidebarUiStore((store) => store.branchSwitcherIsLoading)
  const isMutating = useRightSidebarUiStore((store) => store.branchSwitcherIsMutating)
  const query = useRightSidebarUiStore((store) => store.branchSwitcherQuery)
  const entryView = useRightSidebarUiStore((store) => store.branchSwitcherEntryView)
  const branchList = useRightSidebarUiStore((store) => store.branchList)
  const error = useRightSidebarUiStore((store) => store.branchSwitcherError)
  const setOpen = useRightSidebarUiStore((store) => store.setBranchSwitcherOpen)
  const setMergeModalOpen = useRightSidebarUiStore((store) => store.setMergeModalOpen)
  const setIsLoading = useRightSidebarUiStore((store) => store.setBranchSwitcherIsLoading)
  const setIsMutating = useRightSidebarUiStore((store) => store.setBranchSwitcherIsMutating)
  const setQuery = useRightSidebarUiStore((store) => store.setBranchSwitcherQuery)
  const setEntryView = useRightSidebarUiStore((store) => store.setBranchSwitcherEntryView)
  const setBranchList = useRightSidebarUiStore((store) => store.setBranchList)
  const setError = useRightSidebarUiStore((store) => store.setBranchSwitcherError)

  useEffect(() => {
    if (!open) return
    setIsLoading(true)
    setError(null)
    void onListBranches()
      .then((result) => setBranchList(result))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [onListBranches, open, setBranchList, setError, setIsLoading])

  const normalizedQuery = query.trim().toLowerCase()
  const filterEntries = (entries: ChatBranchListEntry[]) => entries.filter((entry) => {
    if (!normalizedQuery) return true
    return [
      entry.displayName,
      entry.name,
      entry.description,
      entry.prTitle,
      entry.headLabel,
    ].some((value) => value?.toLowerCase().includes(normalizedQuery))
  })

  const currentName = branchList?.currentBranchName ?? currentBranchName
  const pullRequestHeadNames = new Set((branchList?.pullRequests ?? []).map((entry) => entry.headRefName ?? entry.name))
  const recent = filterEntries(branchList?.recent ?? []).filter((entry) => entry.name !== currentName)
  const local = filterEntries(branchList?.local ?? []).filter((entry) => entry.name !== currentName)
  const remote = filterEntries(branchList?.remote ?? []).filter((entry) => entry.name !== currentName && !pullRequestHeadNames.has(entry.name))
  const pullRequests = filterEntries(branchList?.pullRequests ?? []).filter((entry) => entry.name !== currentName)
  const totalPullRequestCount = branchList?.pullRequests.length ?? 0

  async function handleCheckout(entry: ChatBranchListEntry) {
    setIsMutating(true)
    try {
      await onCheckoutBranch(entry)
      setOpen(false)
      setQuery("")
      setEntryView("branches")
    } finally {
      setIsMutating(false)
    }
  }

  async function handleCreate() {
    setIsMutating(true)
    try {
      await onCreateBranch()
      setOpen(false)
      setQuery("")
      setEntryView("branches")
    } finally {
      setIsMutating(false)
    }
  }

  function openMergeModal() {
    setOpen(false)
    setMergeModalOpen(true)
  }

  let pullRequestsEmptyLabel: string
  if (branchList?.pullRequestsStatus === "error") {
    pullRequestsEmptyLabel = branchList.pullRequestsError ?? "Could not load pull requests."
  } else if (branchList?.pullRequestsStatus === "unavailable") {
    pullRequestsEmptyLabel = "Pull requests unavailable for this repository."
  } else {
    pullRequestsEmptyLabel = "No open pull requests."
  }

  let branchListContent: ReactNode
  if (isLoading) {
    branchListContent = (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        <span>Loading branches…</span>
      </div>
    )
  } else if (error) {
    branchListContent = (
      <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">{error}</div>
    )
  } else if (entryView === "pull_requests") {
    branchListContent = (
      <BranchListSection
        title="Open PRs"
        entries={pullRequests}
        emptyLabel={pullRequestsEmptyLabel}
        disabled={isMutating}
        stickyTitle
        onSelect={(entry) => {
          void handleCheckout(entry)
        }}
      />
    )
  } else {
    branchListContent = (
      <div className="space-y-3">
        <BranchListSection
          title="Recent"
          entries={recent}
          emptyLabel="No recent branches."
          disabled={isMutating}
          stickyTitle
          onSelect={(entry) => {
            void handleCheckout(entry)
          }}
        />
        <BranchListSection
          title="Local"
          entries={local}
          emptyLabel="No local branches."
          disabled={isMutating}
          stickyTitle
          onSelect={(entry) => {
            void handleCheckout(entry)
          }}
        />
        <BranchListSection
          title="Remote"
          entries={remote}
          emptyLabel="No remote branches."
          disabled={isMutating}
          stickyTitle
          onSelect={(entry) => {
            void handleCheckout(entry)
          }}
        />
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Open branch switcher"
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{currentBranchName ?? "Detached HEAD"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-2">
        <div className="space-y-2">
          <BranchSearchInput
            value={query}
            onChange={setQuery}
            placeholder={entryView === "pull_requests" ? "Search pull requests" : "Search branches"}
            disabled={isLoading || isMutating}
            trailingAction={(
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleCreate()}
                disabled={isLoading || isMutating}
                className="h-7 px-2 text-xs hover:!bg-transparent hover:!border-border/0"
              >
                + New
              </Button>
            )}
          />
          <SegmentedControl
            value={entryView}
            onValueChange={(value) => { if (isEntryView(value)) setEntryView(value) }}
            size="sm"
            className="w-full"
            optionClassName="flex-1 justify-center"
            options={[
              { value: "branches", label: "Branches" },
              { value: "pull_requests", label: `Open PRs ${totalPullRequestCount}` },
            ]}
          />
          <div className="max-h-[420px] overflow-y-auto pr-1.5 -mr-[8px]">
            {branchListContent}
          </div>
          {currentName ? (
            <Button
              variant="default"
              size="sm"
              disabled={isLoading || isMutating || Boolean(error)}
              onClick={openMergeModal}
              className="h-9 w-full justify-center rounded-lg px-3 text-sm"
            >
              <span className="block max-w-full truncate">
                <GitMerge className="mr-1.5 inline h-3.5 w-3.5 shrink-0" />
                Merge branch into {currentName}...
              </span>
            </Button>
          ) : null}
        </div>
      </PopoverContent>
      <MergeBranchModal
        open={mergeModalOpen}
        onOpenChange={setMergeModalOpen}
        branchList={branchList}
        currentBranchName={currentName}
        onPreviewMergeBranch={onPreviewMergeBranch}
        onMergeBranch={onMergeBranch}
      />
    </Popover>
  )
}

function DiffFileCard({
  file,
  rootRef,
  projectId,
  isCollapsed,
  isChecked,
  editorLabel,
  diffRenderMode,
  wrapLines,
  onToggleCollapsed,
  onToggleChecked,
  fileActions,
  patch,
  patchError,
  isPatchLoading,
  onLoadPatch,
}: {
  file: DiffFile
  rootRef: RefObject<HTMLElement | null>
  projectId: string | null
  isCollapsed: boolean
  isChecked: boolean
  editorLabel: string
  diffRenderMode: DiffRenderMode
  wrapLines: boolean
  onToggleCollapsed: () => void
  onToggleChecked: () => void
  fileActions: DiffFileActions
  patch?: string
  patchError?: string
  isPatchLoading: boolean
  onLoadPatch: (path: string) => Promise<string>
}) {
  const canIgnore = canIgnoreDiffFile(file)
  const canIgnoreFolder = canIgnoreDiffFolder(file)
  const selectedAttachmentId = DiffFileCardStore.useScopedStore((state) => state.selectedAttachmentId)
  const setSelectedAttachmentId = DiffFileCardStore.useScopedStore((state) => state.setSelectedAttachmentId)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const autoLoadPatchKeyRef = useRef<string | null>(null)
  const { sentinelRef, isStuck } = useStickyState<HTMLDivElement>({
    rootRef,
    disabled: isCollapsed,
  })
  const previewAttachment = useMemo(() => getDiffPreviewAttachment(projectId, file), [file, projectId])
  const hasPreviewAttachment = previewAttachment !== null
  const shouldLoadPatchWhenVisible = shouldLoadDiffPatchNow({
    isCollapsed,
    hasPreviewAttachment,
    patch,
    patchError,
    isPatchLoading,
  })

  useEffect(() => {
    if (!shouldLoadPatchWhenVisible) {
      return
    }

    const autoLoadKey = `${file.path}\u0000${file.patchDigest}`
    if (autoLoadPatchKeyRef.current === autoLoadKey) {
      return
    }

    autoLoadPatchKeyRef.current = autoLoadKey
    void onLoadPatch(file.path).catch(() => {})
  }, [file.patchDigest, file.path, onLoadPatch, shouldLoadPatchWhenVisible])

  function handleAttachmentClick(attachment: ChatAttachment) {
    const target = classifyAttachmentPreview(attachment)
    if (target.openInNewTab) {
      if (typeof window !== "undefined") {
        window.open(new URL(attachment.contentUrl, window.location.origin).toString(), "_blank", "noopener,noreferrer")
      }
      return
    }
    setSelectedAttachmentId(attachment.id)
  }

  function openContextMenuFromButton(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    cardRef.current?.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.bottom,
      view: window,
    }))
  }

  function handleToggleRequest() {
    if (!isCollapsed) {
      onToggleCollapsed()
      return
    }

    if (hasPreviewAttachment || patch !== undefined) {
      onToggleCollapsed()
      return
    }

    if (isPatchLoading) {
      return
    }

    const shouldLoadBeforeExpand = patchError !== undefined || shouldLoadDiffPatchNow({
      isCollapsed: false,
      hasPreviewAttachment,
      patch,
      patchError,
      isPatchLoading,
    })
    if (!shouldLoadBeforeExpand) {
      onToggleCollapsed()
      return
    }

    void onLoadPatch(file.path).then(() => {
      onToggleCollapsed()
    }).catch(() => {})
  }

  let collapseIcon: ReactNode
  if (isPatchLoading && isCollapsed && !previewAttachment) {
    collapseIcon = <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
  } else if (isCollapsed) {
    collapseIcon = <ChevronDown className="h-3.5 w-3.5 shrink-0" />
  } else {
    collapseIcon = <ChevronUp className="h-3.5 w-3.5 shrink-0" />
  }

  let patchContent: ReactNode
  if (previewAttachment) {
    patchContent = (
      <div className="flex justify-center p-3">
        {previewAttachment.kind === "image" ? (
          <AttachmentImageCard
            attachment={previewAttachment}
            onClick={() => handleAttachmentClick(previewAttachment)}
          />
        ) : (
          <AttachmentFileCard
            attachment={previewAttachment}
            onClick={() => handleAttachmentClick(previewAttachment)}
          />
        )}
      </div>
    )
  } else if (isPatchLoading) {
    patchContent = (
      <div className="flex items-center justify-center px-3 py-8 text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
        Loading diff...
      </div>
    )
  } else if (patchError) {
    patchContent = (
      <div className="px-3 py-4 text-sm text-destructive">{patchError}</div>
    )
  } else if (patch !== undefined) {
    patchContent = (
      <PatchDiff
        patch={patch}
        options={{
          diffStyle: diffRenderMode,
          disableFileHeader: true,
          disableBackground: false,
          overflow: wrapLines ? "wrap" : "scroll",
          lineDiffType: "word",
          diffIndicators: "classic",
        }}
      />
    )
  } else {
    patchContent = (
      <div className="px-3 py-4 text-sm text-muted-foreground">Diff unavailable.</div>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={cardRef} key={file.path} className="relative rounded-lg border border-border bg-background">
          {!isCollapsed ? <div ref={sentinelRef} className="pointer-events-none absolute inset-x-0 top-0 h-px" aria-hidden="true" /> : null}
          <div
            role="button"
            tabIndex={0}
            onClick={handleToggleRequest}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              handleToggleRequest()
            }}
            className={cn(
              "group/header sticky top-0 z-20 flex cursor-pointer items-center justify-between gap-3 bg-background pl-[7px] pr-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              !isCollapsed && !isStuck && "rounded-t-[calc(theme(borderRadius.lg)-1px)]",
              isCollapsed && "rounded-[calc(theme(borderRadius.lg)-1px)]",
              !isCollapsed && "border-b border-border/50"
            )}
          >
            <div className="flex min-w-0 items-center">
              <StageCheckbox
                checked={isChecked}
                onClick={onToggleChecked}
              />
              <div className="min-w-0 truncate select-none ml-2 mr-1">{file.path}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2 select-none">
              <span className="whitespace-nowrap text-xs font-mono">
                {file.additions > 0 ? <span className="text-success">+{file.additions}</span> : null}
                {file.deletions > 0 ? (
                  <span className={file.additions > 0 ? "ml-2 text-destructive" : "text-destructive"}>
                    -{file.deletions}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                aria-label={`Open actions for ${file.path}`}
                onClick={openContextMenuFromButton}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Ellipsis className="h-3.5 w-3.5 shrink-0" />
              </button>
              {collapseIcon}
            </div>
          </div>
          {!isCollapsed ? (
            <div className="kanna-diff-patch overflow-hidden rounded-b-[calc(theme(borderRadius.lg)-1px)] pb-[1px]">
              {patchContent}
            </div>
          ) : null}
          <FilePreviewSheet
            source={
              previewAttachment && selectedAttachmentId === previewAttachment.id
                ? toPreviewSourceFromAttachment(previewAttachment, "user_attachment")
                : null
            }
            open={previewAttachment !== null && selectedAttachmentId === previewAttachment.id}
            onOpenChange={(open) => !open && setSelectedAttachmentId(null)}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            fileActions.onOpenFile(file.path)
          }}
        >
          <Code className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Open in {editorLabel}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            fileActions.onOpenInFinder(file.path)
          }}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Open in Finder</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            fileActions.onDiscardFile(file.path)
          }}
          className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Discard Changes</span>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canIgnore}
          onSelect={(event) => {
            event.stopPropagation()
            if (!canIgnore) return
            fileActions.onIgnoreFile(file.path)
          }}
        >
          <Ban className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Ignore File</span>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canIgnoreFolder}
          onSelect={(event) => {
            event.stopPropagation()
            if (!canIgnoreFolder) return
            fileActions.onIgnoreFolder(file.path)
          }}
        >
          <Ban className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Ignore folder...</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            fileActions.onCopyFilePath(file.path)
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Copy File Path</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            fileActions.onCopyRelativePath(file.path)
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Copy Relative Path</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function RightSidebarImpl({
  projectId,
  diffs,
  editorLabel,
  diffRenderMode,
  wrapLines,
  onOpenFile,
  onOpenInFinder,
  onDiscardFile,
  onIgnoreFile,
  onIgnoreFolder,
  onCopyFilePath,
  onCopyRelativePath,
  onListBranches,
  onPreviewMergeBranch,
  onMergeBranch,
  onCheckoutBranch,
  onCreateBranch,
  onGenerateCommitMessage,
  onInitializeGit,
  onGetGitHubPublishInfo,
  onCheckGitHubRepoAvailability,
  onSetupGitHub,
  onCommit,
  onSyncWithRemote,
  onLoadPatch,
  onDiffRenderModeChange,
  onWrapLinesChange,
}: RightSidebarProps) {
  const fileActions: DiffFileActions = useMemo(() => ({
    onOpenFile,
    onOpenInFinder,
    onDiscardFile,
    onIgnoreFile,
    onIgnoreFolder,
    onCopyFilePath,
    onCopyRelativePath,
  }), [onOpenFile, onOpenInFinder, onDiscardFile, onIgnoreFile, onIgnoreFolder, onCopyFilePath, onCopyRelativePath])
  const hasChanges = diffs.files.length > 0
  const isGenerating = useRightSidebarUiStore((store) => store.isGenerating)
  const commitModeInFlight = useRightSidebarUiStore((store) => store.commitModeInFlight)
  const isSyncing = useRightSidebarUiStore((store) => store.isSyncing)
  const isGitHubPublishModalOpen = useRightSidebarUiStore((store) => store.isGitHubPublishModalOpen)
  const patchesByPath = useRightSidebarUiStore((store) => store.patchesByPath)
  const patchErrorsByPath = useRightSidebarUiStore((store) => store.patchErrorsByPath)
  const loadingPatchPaths = useRightSidebarUiStore((store) => store.loadingPatchPaths)
  const setIsGenerating = useRightSidebarUiStore((store) => store.setIsGenerating)
  const setCommitModeInFlight = useRightSidebarUiStore((store) => store.setCommitModeInFlight)
  const setIsSyncing = useRightSidebarUiStore((store) => store.setIsSyncing)
  const setIsGitHubPublishModalOpen = useRightSidebarUiStore((store) => store.setIsGitHubPublishModalOpen)
  const reconcilePatches = useRightSidebarUiStore((store) => store.reconcilePatches)
  const setPatchLoading = useRightSidebarUiStore((store) => store.setPatchLoading)
  const clearPatchLoading = useRightSidebarUiStore((store) => store.clearPatchLoading)
  const clearPatchError = useRightSidebarUiStore((store) => store.clearPatchError)
  const setPatchResult = useRightSidebarUiStore((store) => store.setPatchResult)
  const setPatchError = useRightSidebarUiStore((store) => store.setPatchError)
  // Holds the diff file list's own scrollable node (LegendList is the
  // scroller). Passed to each card as the IntersectionObserver root for its
  // sticky header. Populated from `filesListRef` after the list mounts.
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const filesListRef = useRef<LegendListRef | null>(null)
  const patchDigestsByPathRef = useRef<Record<string, string>>({})
  const filePaths = useMemo(() => diffs.files.map((file) => file.path), [diffs.files])
  const filePathsKey = useMemo(() => filePaths.join("\u0000"), [filePaths])
  const defaultViewMode: SidebarViewMode = hasChanges ? "changes" : "history"
  const viewMode = useRightSidebarStore((store) => (projectId ? (store.projectUi[projectId]?.viewMode ?? defaultViewMode) : defaultViewMode))
  const collapsedPaths = useRightSidebarStore((store) => (projectId ? (store.projectUi[projectId]?.collapsedPaths ?? EMPTY_CHECKED_PATHS) : EMPTY_CHECKED_PATHS))
  const summary = useRightSidebarStore((store) => (projectId ? (store.projectUi[projectId]?.summary ?? "") : ""))
  const description = useRightSidebarStore((store) => (projectId ? (store.projectUi[projectId]?.description ?? "") : ""))
  const reconcileCollapsedPaths = useRightSidebarStore((store) => store.reconcileCollapsedPaths)
  const toggleCollapsedPath = useRightSidebarStore((store) => store.toggleCollapsedPath)
  const setViewMode = useRightSidebarStore((store) => store.setViewMode)
  const setCommitDraft = useRightSidebarStore((store) => store.setCommitDraft)
  const clearCommitDraft = useRightSidebarStore((store) => store.clearCommitDraft)
  const checkedPaths = useDiffCommitStore((store) => (projectId ? (store.checkedPathsByProjectId[projectId] ?? EMPTY_CHECKED_PATHS) : EMPTY_CHECKED_PATHS))
  const reconcileCheckedPaths = useDiffCommitStore((store) => store.reconcileProject)
  const setCheckedPath = useDiffCommitStore((store) => store.setChecked)
  const setAllCheckedPaths = useDiffCommitStore((store) => store.setAllChecked)
  const previousHasChangesRef = useRef(hasChanges)

  useEffect(() => {
    if (!projectId) return
    reconcileCollapsedPaths(projectId, filePaths)
  }, [filePaths, filePathsKey, projectId, reconcileCollapsedPaths])

  useEffect(() => {
    const nextDigestsByPath = Object.fromEntries(diffs.files.map((file) => [file.path, file.patchDigest]))
    const isCurrentDigest = (path: string) => patchDigestsByPathRef.current[path] === nextDigestsByPath[path]
    reconcilePatches(filePaths, isCurrentDigest)
    patchDigestsByPathRef.current = nextDigestsByPath
  }, [diffs.files, filePaths, filePathsKey, reconcilePatches])

  useEffect(() => {
    if (!projectId) return
    reconcileCheckedPaths(projectId, filePaths)
  }, [filePaths, filePathsKey, projectId, reconcileCheckedPaths])

  useEffect(() => {
    if (!projectId) return
    const previousHasChanges = previousHasChangesRef.current
    if (previousHasChanges !== hasChanges) {
      setViewMode(projectId, hasChanges ? "changes" : "history")
      previousHasChangesRef.current = hasChanges
      return
    }
    previousHasChangesRef.current = hasChanges
  }, [hasChanges, projectId, setViewMode])

  const selectedPaths = useMemo(
    () => diffs.files.filter((file) => checkedPaths[file.path] ?? true).map((file) => file.path),
    [checkedPaths, diffs.files]
  )
  const selectedCount = selectedPaths.length
  const allSelected = diffs.files.length > 0 && selectedCount === diffs.files.length
  const someSelected = selectedCount > 0 && selectedCount < diffs.files.length
  const trimmedSummary = summary.trim()
  const hasSummary = trimmedSummary.length > 0
  const isCommitting = commitModeInFlight !== null
  const isBusy = isGenerating || isCommitting
  const branchHistory = diffs.branchHistory?.entries ?? []
  const behindCount = diffs.behindCount ?? 0
  const aheadCount = diffs.aheadCount ?? 0
  const isPublishedBranch = diffs.hasUpstream === true
  const isPublishableBranch = diffs.hasUpstream === false && Boolean(diffs.branchName)
  const hasRemoteOrigin = diffs.hasOriginRemote === true
  const encodedBranchName = diffs.branchName
    ? diffs.branchName.split("/").map((segment) => encodeURIComponent(segment)).join("/")
    : null
  let syncAction: "fetch" | "pull" | "publish"
  if (isPublishableBranch) {
    syncAction = "publish"
  } else if (behindCount > 0) {
    syncAction = "pull"
  } else {
    syncAction = "fetch"
  }
  const compareUrl = diffs.originRepoSlug && encodedBranchName
    ? `https://github.com/${diffs.originRepoSlug}/compare/${encodedBranchName}?expand=1`
    : null
  const canOpenPullRequest = Boolean(
    isPublishedBranch
    && compareUrl
    && diffs.branchName
    && diffs.branchName !== diffs.defaultBranchName
  )
  const canGenerate = diffs.status === "ready"
    && selectedCount > 0
    && !isBusy
  const canCommit = diffs.status === "ready"
    && selectedCount > 0
    && hasSummary
    && !isBusy
  const primaryCommitMode: DiffCommitMode = hasRemoteOrigin ? "commit_and_push" : "commit_only"
  const resolvedBranchName = diffs.branchName ?? "current branch"

  async function handleCommit(mode: DiffCommitMode) {
    if (!canCommit) return
    setCommitModeInFlight(mode)
    try {
      const result = await onCommit({
        paths: selectedPaths,
        summary: trimmedSummary,
        description: description.trim(),
        mode,
      })
      if (result?.ok || result?.localCommitCreated) {
        if (projectId) {
          clearCommitDraft(projectId)
        }
      }
    } finally {
      setCommitModeInFlight(null)
    }
  }

  async function handleGenerate() {
    if (!canGenerate) return
    setIsGenerating(true)
    try {
      const result = await onGenerateCommitMessage({ paths: selectedPaths })
      if (projectId) {
        setCommitDraft(projectId, {
          summary: result.subject,
          description: result.body,
        })
      }
    } finally {
      setIsGenerating(false)
    }
  }

  function handleCommitKeyDown(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") {
      return
    }
    event.preventDefault()
    if (hasSummary) {
      void handleCommit(primaryCommitMode)
      return
    }
    void handleGenerate()
  }

  async function handleSync(action: "fetch" | "pull" | "push" | "publish" = syncAction) {
    if (diffs.status !== "ready" || isSyncing) return
    setIsSyncing(true)
    try {
      await onSyncWithRemote(action)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleLoadPatch = useCallback(async (path: string) => {
    const { patchesByPath: currentPatches, loadingPatchPaths: currentLoading } = useRightSidebarUiStore.getState()
    if (currentPatches[path] !== undefined || currentLoading[path]) {
      return currentPatches[path] ?? ""
    }

    setPatchLoading(path)
    clearPatchError(path)

    try {
      const patch = await onLoadPatch(path)
      setPatchResult(path, patch)
      const digest = diffs.files.find((file) => file.path === path)?.patchDigest
      if (digest) {
        patchDigestsByPathRef.current = {
          ...patchDigestsByPathRef.current,
          [path]: digest,
        }
      }
      return patch
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPatchError(path, message)
      throw error
    } finally {
      clearPatchLoading(path)
    }
  }, [clearPatchError, clearPatchLoading, diffs.files, onLoadPatch, setPatchError, setPatchLoading, setPatchResult])

  const diffFileKey = useCallback((file: DiffFile) => file.path, [])

  const renderDiffFileItem = useCallback(
    ({ item: file }: { item: DiffFile }) => {
      const isCollapsed = collapsedPaths[file.path] ?? true
      const isChecked = checkedPaths[file.path] ?? true
      return (
        <div className="pb-1.5">
          <DiffFileCardStore.Provider init={undefined}>
            <DiffFileCard
              file={file}
              rootRef={scrollContainerRef}
              projectId={projectId}
              isCollapsed={isCollapsed}
              isChecked={isChecked}
              editorLabel={editorLabel}
              diffRenderMode={diffRenderMode}
              wrapLines={wrapLines}
              onToggleCollapsed={() => {
                if (!projectId) return
                toggleCollapsedPath(projectId, file.path)
              }}
              onToggleChecked={() => {
                if (!projectId) return
                setCheckedPath(projectId, file.path, !isChecked)
              }}
              fileActions={fileActions}
              patch={patchesByPath[file.path]}
              patchError={patchErrorsByPath[file.path]}
              isPatchLoading={Boolean(loadingPatchPaths[file.path])}
              onLoadPatch={handleLoadPatch}
            />
          </DiffFileCardStore.Provider>
        </div>
      )
    },
    [
      checkedPaths,
      collapsedPaths,
      diffRenderMode,
      editorLabel,
      fileActions,
      handleLoadPatch,
      loadingPatchPaths,
      patchErrorsByPath,
      patchesByPath,
      projectId,
      setCheckedPath,
      toggleCollapsedPath,
      wrapLines,
    ],
  )

  // LegendList owns its scroll node; mirror it into scrollContainerRef so each
  // card's sticky-header IntersectionObserver has the right root.
  useEffect(() => {
    const node = filesListRef.current?.getScrollableNode?.()
    scrollContainerRef.current = node instanceof HTMLElement ? node : null
  }, [viewMode, diffs.files.length])

  let stageCheckboxLabel: string
  if (someSelected) {
    stageCheckboxLabel = "Select all files for commit"
  } else if (allSelected) {
    stageCheckboxLabel = "Unselect all files from commit"
  } else {
    stageCheckboxLabel = "Select all files for commit"
  }

  let syncButtonArea: ReactNode
  if (diffs.status === "ready") {
    if (!hasRemoteOrigin) {
      syncButtonArea = (
        <Button
          variant="default"
          size="sm"
          onClick={() => setIsGitHubPublishModalOpen(true)}
          className="h-7 gap-1.5 px-3 text-xs"
        >
          <Github className="h-3.5 w-3.5" />
          <span>Push to GitHub</span>
        </Button>
      )
    } else if (syncAction === "publish") {
      syncButtonArea = (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleSync()}
          disabled={isSyncing}
          className="h-7 gap-1.5 px-2 text-xs hover:!bg-transparent hover:!border-border/0"
        >
          {isSyncing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          <span>Publish Branch</span>
        </Button>
      )
    } else {
      syncButtonArea = (
        <div className="flex items-center gap-1">
          {syncAction === "fetch" ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleSync()}
                  disabled={isSyncing}
                  className="h-7 gap-1.5 px-2 text-xs hover:!bg-transparent hover:!border-border/0"
                >
                  {isSyncing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  <span>Fetch</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{formatFetchTooltip(diffs.lastFetchedAt)}</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleSync()}
              disabled={isSyncing}
              className="h-7 gap-1.5 px-2 text-xs hover:!bg-transparent hover:!border-border/0"
            >
              {isSyncing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span>Pull</span>
              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] text-muted-foreground">
                {behindCount}
              </span>
            </Button>
          )}
          {isPublishedBranch && aheadCount > 0 ? (
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleSync("push")}
              disabled={isSyncing}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              {isSyncing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              <span>Push</span>
              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary-foreground/15 px-1 text-[10px] text-primary-foreground">
                {aheadCount}
              </span>
            </Button>
          ) : null}
          {canOpenPullRequest && compareUrl ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (typeof window === "undefined") return
                window.open(compareUrl, "_blank", "noopener,noreferrer")
              }}
              className="h-7 gap-1.5 px-2 text-xs hover:!bg-transparent hover:!border-border/0"
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              <span>PR</span>
            </Button>
          ) : null}
        </div>
      )
    }
  } else {
    syncButtonArea = null
  }

  let mainContent: ReactNode
  if (diffs.status === "no_repo") {
    mainContent = (
      <div className="flex h-full items-center justify-center px-6 py-3 text-center">
        <div className="flex max-w-[280px] flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">Initialize git here to start tracking branches, diffs, and history.</p>
          <Button size="sm" onClick={() => void onInitializeGit()}>
            Init Git
          </Button>
        </div>
      </div>
    )
  } else if (viewMode === "history") {
    if (branchHistory.length === 0) {
      mainContent = (
        <div className="flex h-full items-center justify-center px-6 py-3 text-center">
          <p className="text-sm text-muted-foreground">No recent commits on {diffs.branchName ?? "this branch"}.</p>
        </div>
      )
    } else {
      mainContent = (
        <div className="h-full overflow-y-auto [scrollbar-gutter:stable] space-y-1.5 p-1.5">
          {branchHistory.map((entry, index) => <CommitHistoryRow key={entry.sha} entry={entry} isPendingPush={index < aheadCount} />)}
        </div>
      )
    }
  } else if (diffs.files.length === 0) {
    mainContent = (
      <div className="flex h-full items-center justify-center px-6 py-3 text-center">
        <p className="text-sm text-muted-foreground">No file changes.</p>
      </div>
    )
  } else {
    mainContent = null
  }

  let commitButtonIcon: ReactNode
  if (hasSummary) {
    if (isCommitting) {
      commitButtonIcon = <LoaderCircle strokeWidth={2.5} className="size-3 shrink-0 animate-spin" />
    } else if (primaryCommitMode === "commit_and_push" && diffs.hasUpstream) {
      commitButtonIcon = <Upload strokeWidth={2.5} className="size-3 shrink-0" />
    } else if (primaryCommitMode === "commit_and_push") {
      commitButtonIcon = <GitBranchPlus strokeWidth={2.5} className="size-3 shrink-0" />
    } else {
      commitButtonIcon = <Check strokeWidth={2.5} className="size-3 shrink-0" />
    }
  } else if (isGenerating) {
    commitButtonIcon = <LoaderCircle strokeWidth={2.5} className="size-3 shrink-0 animate-spin" />
  } else {
    commitButtonIcon = <PenLine strokeWidth={2.5} className="size-3 shrink-0" />
  }

  let commitButtonLabel: ReactNode
  if (hasSummary) {
    if (isCommitting) {
      commitButtonLabel = commitModeInFlight === "commit_only" ? "Committing..." : "Committing & Pushing..."
    } else if (primaryCommitMode === "commit_only") {
      commitButtonLabel = <>Commit to <GitBranch strokeWidth={2.5} className="mr-[4.5px] ml-0.5 inline size-3 " />{resolvedBranchName}</>
    } else if (diffs.hasUpstream) {
      commitButtonLabel = <>Commit &amp; push to <GitBranch strokeWidth={2.5} className="mr-[4.5px] ml-0.5 inline size-3 " />{resolvedBranchName}</>
    } else {
      commitButtonLabel = <>Commit &amp; publish <GitBranch strokeWidth={2.5} className="mr-[4.5px] ml-0.5 inline size-3 " />{resolvedBranchName}</>
    }
  } else if (isGenerating) {
    commitButtonLabel = "Generating..."
  } else {
    commitButtonLabel = <>Generate message for <GitBranch strokeWidth={2.5} className="mr-[4.5px] ml-0.5 inline size-3 " />{resolvedBranchName}</>
  }

  return (
    <div className="h-full min-h-0 border-l border-border bg-background md:min-w-[370px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border pl-2.5 pr-2 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <BranchSwitcher
              currentBranchName={diffs.branchName}
              onListBranches={onListBranches}
              onPreviewMergeBranch={onPreviewMergeBranch}
              onMergeBranch={onMergeBranch}
              onCheckoutBranch={onCheckoutBranch}
              onCreateBranch={onCreateBranch}
            />
          </div>
          {syncButtonArea}
        </div>
        <div className="relative min-h-0 flex-1">
          <div className="sticky top-0 z-30 pl-[14px] pr-[12px] pt-[6px] bg-gradient-to-b from-background to-transparent">
            <div className="relative h-[40px]  flex min-w-0 items-center justify-center gap-[13px]">
              <div className="flex min-w-0 flex-1 items-center justify-between gap-[13px] relative">
                {viewMode === "changes" ? (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                    <StageCheckbox
                      checked={allSelected}
                      mixed={someSelected}
                      label={stageCheckboxLabel}
                      onClick={() => {
                        if (!projectId || diffs.files.length === 0) return
                        setAllCheckedPaths(projectId, filePaths, someSelected ? true : !allSelected)
                      }}
                    />
                    <span>{selectedCount} files</span>
                  </div>
                ) : <div />}
                <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
                  <div className="pointer-events-auto">
                    <SegmentedControl
                      value={viewMode}
                      onValueChange={(value) => {
                        if (!projectId) return
                        if (isSidebarViewMode(value)) setViewMode(projectId, value)
                      }}
                      size="sm"
                      optionClassName="flex-1 justify-center"
                      options={[
                        { value: "changes", label: "Changes"},
                        { value: "history", label: "History" },
                      ]}
                    />
                  </div>
                </div>
                {viewMode === "changes" ? (
                  <div className="flex items-center gap-1">
                    <IconButton
                      label="Unified diff"
                      active={diffRenderMode === "unified"}
                      onClick={() => onDiffRenderModeChange("unified")}
                    >
                      <Rows3 className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      label="Side-by-side diff"
                      active={diffRenderMode === "split"}
                      onClick={() => onDiffRenderModeChange("split")}
                    >
                      <Columns2 className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      label={wrapLines ? "Disable word wrap" : "Enable word wrap"}
                      active={wrapLines}
                      onClick={() => onWrapLinesChange(!wrapLines)}
                    >
                      <WrapText className="h-4 w-4" />
                    </IconButton>
                  </div>
                ) : <div />}
              </div>
            </div>
          </div>
          <div className="h-full min-h-0">
            {mainContent}
            {diffs.status !== "no_repo" && viewMode !== "history" && diffs.files.length > 0 && (
              <div className="relative h-full min-h-0">
                <LegendList<DiffFile>
                  ref={filesListRef}
                  data={diffs.files}
                  keyExtractor={diffFileKey}
                  renderItem={renderDiffFileItem}
                  extraData={{ collapsedPaths, checkedPaths, patchesByPath, patchErrorsByPath, loadingPatchPaths, diffRenderMode, wrapLines }}
                  estimatedItemSize={44}
                  className="h-full overflow-y-auto [scrollbar-gutter:stable] p-1.5"
                  contentContainerStyle={{ paddingBottom: viewMode === "changes" ? 220 : 40 }}
                />

                {viewMode === "changes" ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 py-1 pb-6 z-30">
                  <div className="absolute inset-x-0 bottom-0 top-0 bg-gradient-to-t from-background to-transparent" />
                  <div className="pointer-events-auto relative">
                    <div className="space-y-0 rounded-xl mx-auto max-w-[700px]">
                      <Input
                        value={summary}
                        onChange={(event) => {
                          if (!projectId) return
                          setCommitDraft(projectId, {
                            summary: event.target.value,
                            description,
                          })
                        }}
                        onKeyDown={handleCommitKeyDown}
                        placeholder="Commit message (override)"
                        className="rounded-t-xl rounded-b-none px-3"
                        disabled={isBusy || diffs.status !== "ready"}
                      />
                      <Textarea
                        value={description}
                        onChange={(event) => {
                          if (!projectId) return
                          setCommitDraft(projectId, {
                            summary,
                            description: event.target.value,
                          })
                        }}
                        onKeyDown={handleCommitKeyDown}
                        placeholder="Description"
                        rows={5}
                        className="-mt-px rounded-t-none rounded-b-xl px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background mb-2"
                        disabled={isBusy || diffs.status !== "ready"}
                      />
                      <div className="w-full flex flex-row">
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <Button
                            type="button"
                            className="-mt-px w-full rounded-xl"
                            disabled={hasSummary ? !canCommit : !canGenerate}
                            onClick={() => {
                              if (hasSummary) {
                                void handleCommit(primaryCommitMode)
                                return
                              }
                              void handleGenerate()
                            }}
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              {commitButtonIcon}
                              <span className="min-w-0 truncate text-left">
                                {commitButtonLabel}
                              </span>
                            </span>
                          </Button>
                        </ContextMenuTrigger>
                        {diffs.hasUpstream ? (
                          <ContextMenuContent>
                            <ContextMenuItem
                              disabled={!hasSummary || !canCommit}
                              onSelect={(event) => {
                                event.stopPropagation()
                                void handleCommit("commit_only")
                              }}
                            >
                              Commit Only
                            </ContextMenuItem>
                          </ContextMenuContent>
                        ) : null}
                      </ContextMenu>
                      </div>
                    </div>
                  </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
        <GitHubPublishModal
          open={isGitHubPublishModalOpen}
          onOpenChange={setIsGitHubPublishModalOpen}
          onGetGitHubPublishInfo={onGetGitHubPublishInfo}
          onCheckGitHubRepoAvailability={onCheckGitHubRepoAvailability}
          onPublish={onSetupGitHub}
        />
      </div>
    </div>
  )
}

export const RightSidebar = memo(RightSidebarImpl)
