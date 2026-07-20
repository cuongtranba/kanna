import { useEffect, useRef } from "react"
import { DEFAULT_NEW_PROJECT_ROOT } from "../../shared/branding"
import type { TimerPort } from "../ports/timerPort"
import { timerAdapter } from "../adapters/timer.adapter"
import { Button } from "./ui/button"
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog"
import { Input } from "./ui/input"
import { SegmentedControl } from "./ui/segmented-control"
import {
  useNewProjectModalStore,
  useNewProjectTab,
  useNewProjectName,
  useNewProjectExistingPath,
  type NewProjectModalTab,
} from "../stores/newProjectModalStore"

export interface NewProjectModalPorts {
  timer?: TimerPort
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (project: { mode: NewProjectModalTab; localPath: string; title: string }) => void
  ports?: NewProjectModalPorts
}

function toKebab(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function NewProjectModal({ open, onOpenChange, onConfirm, ports = {} }: Props) {
  const timer = ports.timer ?? timerAdapter
  const tab = useNewProjectTab()
  const name = useNewProjectName()
  const existingPath = useNewProjectExistingPath()
  const setTab = useNewProjectModalStore((state) => state.setTab)
  const setName = useNewProjectModalStore((state) => state.setName)
  const setExistingPath = useNewProjectModalStore((state) => state.setExistingPath)
  const resetForOpen = useNewProjectModalStore((state) => state.resetForOpen)
  const inputRef = useRef<HTMLInputElement>(null)
  const existingInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      resetForOpen()
      timer.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open, resetForOpen, timer])

  useEffect(() => {
    if (open) {
      timer.setTimeout(() => {
        if (tab === "new") inputRef.current?.focus()
        else existingInputRef.current?.focus()
      }, 0)
    }
  }, [tab, open, timer])

  const kebab = toKebab(name)
  const newPath = kebab ? `${DEFAULT_NEW_PROJECT_ROOT}/${kebab}` : ""
  const trimmedExisting = existingPath.trim()

  const canSubmit = tab === "new" ? Boolean(kebab) : Boolean(trimmedExisting)

  const handleSubmit = () => {
    if (!canSubmit) return
    if (tab === "new") {
      onConfirm({ mode: "new", localPath: newPath, title: name.trim() })
    } else {
      const folderName = trimmedExisting.split("/").pop() || trimmedExisting
      onConfirm({ mode: "existing", localPath: trimmedExisting, title: folderName })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogBody className="space-y-4">
          <DialogTitle>Add Project</DialogTitle>

          <SegmentedControl
            value={tab}
            onValueChange={setTab}
            options={[
              { value: "new" satisfies NewProjectModalTab, label: "New Folder" },
              { value: "existing" satisfies NewProjectModalTab, label: "Existing Path" },
            ]}
            className="w-full mb-2"
            optionClassName="flex-1 justify-center"
          />

          {tab === "new" ? (
            <div className="space-y-2">
              <Input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit()
                  if (e.key === "Escape") onOpenChange(false)
                }}
                placeholder="Project name"
              />
              {newPath && (
                <p className="text-xs text-muted-foreground font-mono">
                  {newPath}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                ref={existingInputRef}
                type="text"
                value={existingPath}
                onChange={(e) => setExistingPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit()
                  if (e.key === "Escape") onOpenChange(false)
                }}
                placeholder="~/Projects/my-app"
              />
              <p className="text-xs text-muted-foreground">
                The folder will be created if it doesn't exist.
              </p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
