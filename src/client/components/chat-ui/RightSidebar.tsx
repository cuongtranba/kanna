import { PatchDiff } from "@pierre/diffs/react"
import { Check, ChevronDown, ChevronUp, Columns2, ExternalLink, Rows3, SquareArrowRight, SquareDot, SquareMinus, SquarePlus, WrapText, X } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import type { ChatAttachment, ChatDiffSnapshot } from "../../../shared/types"
import { useStickyState } from "../../hooks/useStickyState"
import { cn } from "../../lib/utils"
import { useDiffCommitStore } from "../../stores/diffCommitStore"
import { AttachmentFileCard, AttachmentImageCard } from "../messages/AttachmentCard"
import { AttachmentPreviewModal } from "../messages/AttachmentPreviewModal"
import { classifyAttachmentPreview } from "../messages/attachmentPreview"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Textarea } from "../ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"

type DiffRenderMode = "unified" | "split"
type DiffFile = ChatDiffSnapshot["files"][number]
const EMPTY_CHECKED_PATHS: Record<string, boolean> = {}

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

interface RightSidebarProps {
  projectId: string | null
  diffs: ChatDiffSnapshot
  diffRenderMode: DiffRenderMode
  wrapLines: boolean
  onOpenFile: (path: string) => void
  onGenerateCommitMessage: (args: { paths: string[] }) => Promise<{ subject: string; body: string }>
  onCommit: (args: { paths: string[]; summary: string; description: string }) => Promise<void>
  onDiffRenderModeChange: (mode: DiffRenderMode) => void
  onWrapLinesChange: (wrap: boolean) => void
  onClose: () => void
}

function getPatchCounts(patch: string) {
  let additions = 0
  let deletions = 0

  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) {
      continue
    }
    if (line.startsWith("+")) {
      additions += 1
      continue
    }
    if (line.startsWith("-")) {
      deletions += 1
    }
  }

  return { additions, deletions }
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
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
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

function ChangeTypeBadge({ changeType }: { changeType: DiffFile["changeType"] }) {
  if (changeType === "modified") {
    return <SquareDot className="h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
  }

  if (changeType === "added") {
    return <SquarePlus className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
  }

  if (changeType === "deleted") {
    return <SquareMinus className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
  }

  return <SquareArrowRight className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
}

function StageCheckbox({
  checked,
  onClick,
}: {
  checked: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={checked ? "Exclude file from commit" : "Include file in commit"}
      aria-pressed={checked}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex size-4.5 shrink-0 items-center justify-center rounded border transition-colors",
        checked
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-transparent"
      )}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  )
}

function DiffFileCard({
  file,
  rootRef,
  projectId,
  isCollapsed,
  isChecked,
  diffRenderMode,
  wrapLines,
  onToggleCollapsed,
  onToggleChecked,
  onOpenFile,
}: {
  file: DiffFile
  rootRef: RefObject<HTMLDivElement | null>
  projectId: string | null
  isCollapsed: boolean
  isChecked: boolean
  diffRenderMode: DiffRenderMode
  wrapLines: boolean
  onToggleCollapsed: () => void
  onToggleChecked: () => void
  onOpenFile: (path: string) => void
}) {
  const counts = getPatchCounts(file.patch)
  const previewAttachment = useMemo(() => getDiffPreviewAttachment(projectId, file), [file, projectId])
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null)
  const { sentinelRef, isStuck } = useStickyState<HTMLDivElement>({
    rootRef,
    disabled: isCollapsed,
  })

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

  return (
    <div key={file.path} className="relative rounded-lg border border-border bg-background">
      {!isCollapsed ? <div ref={sentinelRef} className="pointer-events-none absolute inset-x-0 top-0 h-px" aria-hidden="true" /> : null}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleCollapsed}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          onToggleCollapsed()
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
            onClick={() => {
              if (!projectId) return
              onToggleChecked()
            }}
          />
          <div className="min-w-0 truncate select-none ml-2 mr-1">{file.path}</div>
          <button
            type="button"
            aria-label={`Open ${file.path} in editor`}
            title={file.path}
            onClick={(event) => {
              event.stopPropagation()
              onOpenFile(file.path)
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-[opacity,color,background-color] group-hover/header:opacity-70 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2 select-none">
          <span className="whitespace-nowrap text-xs font-mono">
            {counts.additions > 0 ? <span className="text-emerald-600 dark:text-emerald-400">+{counts.additions}</span> : null}
            {counts.deletions > 0 ? (
              <span className={counts.additions > 0 ? "ml-2 text-red-600 dark:text-red-400" : "text-red-600 dark:text-red-400"}>
                -{counts.deletions}
              </span>
            ) : null}
          </span>
          <ChangeTypeBadge changeType={file.changeType} />
          {isCollapsed ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronUp className="h-3.5 w-3.5 shrink-0" />}
        </div>
      </div>
      {!isCollapsed ? (
        <div className="kanna-diff-patch overflow-hidden rounded-b-[calc(theme(borderRadius.lg)-1px)] pb-[1px]">
          {previewAttachment ? (
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
          ) : (
            <PatchDiff
              patch={file.patch}
              options={{
                diffStyle: diffRenderMode,
                disableFileHeader: true,
                overflow: wrapLines ? "wrap" : "scroll",
                lineDiffType: "word",
                diffIndicators: "classic",
              }}
            />
          )}
        </div>
      ) : null}
      <AttachmentPreviewModal
        attachment={previewAttachment && selectedAttachmentId === previewAttachment.id ? previewAttachment : null}
        onOpenChange={(open) => !open && setSelectedAttachmentId(null)}
      />
    </div>
  )
}

function RightSidebarImpl({
  projectId,
  diffs,
  diffRenderMode,
  wrapLines,
  onOpenFile,
  onGenerateCommitMessage,
  onCommit,
  onDiffRenderModeChange,
  onWrapLinesChange,
  onClose,
}: RightSidebarProps) {
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(diffs.files.map((file) => [file.path, true]))
  )
  const [summary, setSummary] = useState("")
  const [description, setDescription] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCommitting, setIsCommitting] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const filePaths = useMemo(() => diffs.files.map((file) => file.path), [diffs.files])
  const filePathsKey = useMemo(() => filePaths.join("\u0000"), [filePaths])
  const checkedPaths = useDiffCommitStore((store) => (projectId ? (store.checkedPathsByProjectId[projectId] ?? EMPTY_CHECKED_PATHS) : EMPTY_CHECKED_PATHS))
  const reconcileCheckedPaths = useDiffCommitStore((store) => store.reconcileProject)
  const setCheckedPath = useDiffCommitStore((store) => store.setChecked)

  useEffect(() => {
    setCollapsedPaths((current) => {
      const next: Record<string, boolean> = {}
      for (const filePath of filePaths) {
        next[filePath] = current[filePath] ?? true
      }
      if (
        Object.keys(current).length === Object.keys(next).length
        && Object.entries(next).every(([path, value]) => current[path] === value)
      ) {
        return current
      }
      return next
    })
  }, [filePaths, filePathsKey])

  useEffect(() => {
    if (!projectId) return
    reconcileCheckedPaths(projectId, filePaths)
  }, [filePaths, filePathsKey, projectId, reconcileCheckedPaths])

  const selectedPaths = useMemo(
    () => diffs.files.filter((file) => checkedPaths[file.path] ?? true).map((file) => file.path),
    [checkedPaths, diffs.files]
  )
  const selectedCount = selectedPaths.length
  const trimmedSummary = summary.trim()
  const hasSummary = trimmedSummary.length > 0
  const isBusy = isGenerating || isCommitting
  const canGenerate = diffs.status === "ready"
    && selectedCount > 0
    && !isBusy
  const canCommit = diffs.status === "ready"
    && selectedCount > 0
    && hasSummary
    && !isBusy

  async function handleCommit() {
    if (!canCommit) return
    setIsCommitting(true)
    try {
      await onCommit({
        paths: selectedPaths,
        summary: trimmedSummary,
        description: description.trim(),
      })
      setSummary("")
      setDescription("")
    } finally {
      setIsCommitting(false)
    }
  }

  async function handleGenerate() {
    if (!canGenerate) return
    setIsGenerating(true)
    try {
      const result = await onGenerateCommitMessage({ paths: selectedPaths })
      setSummary(result.subject)
      setDescription(result.body)
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
      void handleCommit()
      return
    }
    void handleGenerate()
  }

  return (
    <div className="h-full min-h-0 border-l border-border bg-background md:min-w-[300px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="truncate text-xs text-muted-foreground">Diffs</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
            <button
              type="button"
              aria-label="Close right sidebar"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={scrollContainerRef} className="h-full overflow-y-auto [scrollbar-gutter:stable]">
            {diffs.status === "no_repo" ? (
              <div className="flex h-full items-center justify-center px-6 py-3 text-center">
                <p className="text-sm text-muted-foreground">Open a git repo to view current file diffs.</p>
              </div>
            ) : diffs.files.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6 py-3 text-center">
                <p className="text-sm text-muted-foreground">No file changes.</p>
              </div>
            ) : (
              <div className="space-y-1.5 p-1.5 pb-44 pr-0">
                {diffs.files.map((file) => {
                  const isCollapsed = collapsedPaths[file.path] ?? true
                  const isChecked = checkedPaths[file.path] ?? true

                  return (
                    <DiffFileCard
                      key={file.path}
                      file={file}
                      rootRef={scrollContainerRef}
                      projectId={projectId}
                      isCollapsed={isCollapsed}
                      isChecked={isChecked}
                      diffRenderMode={diffRenderMode}
                      wrapLines={wrapLines}
                      onToggleCollapsed={() => setCollapsedPaths((current) => ({ ...current, [file.path]: !isCollapsed }))}
                      onToggleChecked={() => {
                        if (!projectId) return
                        setCheckedPath(projectId, file.path, !isChecked)
                      }}
                      onOpenFile={onOpenFile}
                    />
                  )
                })}
              </div>
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 p-3 pt-14">
            <div className="absolute inset-x-0 bottom-0 top-0 bg-gradient-to-t from-background  to-transparent" />
            <div className="pointer-events-auto relative mx-auto max-w-[750px]">
              <div className="space-y-0">
                <Input
                  value={summary}
                  onChange={(event) => {
                    setSummary(event.target.value)
                  }}
                  onKeyDown={handleCommitKeyDown}
                  placeholder="Commit message (override)"
                  className="rounded-t-xl rounded-b-none px-3"
                  disabled={isBusy || diffs.status !== "ready"}
                />
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  onKeyDown={handleCommitKeyDown}
                  placeholder="Description"
                  rows={3}
                  className="-mt-px rounded-t-none rounded-b-none px-3 outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:border-border"
                  disabled={isBusy || diffs.status !== "ready"}
                />
                <Button
                  type="button"
                  className="-mt-px w-full rounded-t-none rounded-b-xl"
                  disabled={hasSummary ? !canCommit : !canGenerate}
                  onClick={() => {
                    if (hasSummary) {
                      void handleCommit()
                      return
                    }
                    void handleGenerate()
                  }}
                >
                  {hasSummary
                    ? (isCommitting
                      ? "Committing..."
                      : `Commit ${selectedCount} ${selectedCount === 1 ? "file" : "files"} to ${diffs.branchName ?? "current branch"}`)
                    : (isGenerating
                      ? "Generating..."
                      : `Generate message for ${selectedCount} ${selectedCount === 1 ? "file" : "files"} on ${diffs.branchName ?? "current branch"}`)}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const RightSidebar = memo(RightSidebarImpl)
