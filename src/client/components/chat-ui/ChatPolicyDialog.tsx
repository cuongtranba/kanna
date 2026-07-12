import { Button } from "../ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogTitle } from "../ui/dialog"
import { SegmentedControl } from "../ui/segmented-control"
import type { ChatPermissionPolicy, ChatPermissionPolicyOverride } from "../../../shared/permission-policy"
import { ChatPolicyDialogStore } from "./ChatPolicyDialog.store"

type DefaultAction = ChatPermissionPolicy["defaultAction"]

interface Props {
  open: boolean
  chatTitle: string
  baseline: ChatPermissionPolicy
  current: ChatPermissionPolicyOverride | null
  onApply: (next: ChatPermissionPolicyOverride | null) => void
  onCancel: () => void
}

function listToText(values: string[] | undefined): string {
  return (values ?? []).join("\n")
}

function textToList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

export function ChatPolicyDialog(props: Props) {
  // Mount the inner stateful component only while the dialog is open so its
  // initial state is always derived from the current chat's policyOverride
  // without a reset effect.
  if (!props.open) return null
  return <ChatPolicyDialogInner {...props} />
}

function ChatPolicyDialogInner({ open, chatTitle, baseline, current, onApply, onCancel }: Props) {
  const initialDefaultAction = current?.defaultAction ?? baseline.defaultAction
  const initialReadDenyText = listToText(current?.readPathDeny ?? baseline.readPathDeny)
  const initialWriteDenyText = listToText(current?.writePathDeny ?? baseline.writePathDeny)

  return (
    <ChatPolicyDialogStore.Provider
      init={{ initialDefaultAction, initialReadDenyText, initialWriteDenyText }}
    >
      <ChatPolicyDialogContent
        open={open}
        chatTitle={chatTitle}
        baseline={baseline}
        onApply={onApply}
        onCancel={onCancel}
      />
    </ChatPolicyDialogStore.Provider>
  )
}

interface ContentProps {
  open: boolean
  chatTitle: string
  baseline: ChatPermissionPolicy
  onApply: (next: ChatPermissionPolicyOverride | null) => void
  onCancel: () => void
}

function ChatPolicyDialogContent({ open, chatTitle, baseline, onApply, onCancel }: ContentProps) {
  const defaultAction = ChatPolicyDialogStore.useScopedStore((state) => state.defaultAction)
  const readDenyText = ChatPolicyDialogStore.useScopedStore((state) => state.readDenyText)
  const writeDenyText = ChatPolicyDialogStore.useScopedStore((state) => state.writeDenyText)
  const confirmUnsafeOpen = ChatPolicyDialogStore.useScopedStore((state) => state.confirmUnsafeOpen)
  const pendingDefaultAction = ChatPolicyDialogStore.useScopedStore((state) => state.pendingDefaultAction)
  const storeApi = ChatPolicyDialogStore.useScopedStoreApi()

  function handleDefaultActionChange(next: DefaultAction) {
    const state = storeApi.getState()
    if (next === "auto-allow" && state.defaultAction !== "auto-allow") {
      state.setPendingDefaultAction(next)
      state.setConfirmUnsafeOpen(true)
      return
    }
    state.setDefaultAction(next)
  }

  function buildOverride(): ChatPermissionPolicyOverride | null {
    const readDeny = textToList(readDenyText)
    const writeDeny = textToList(writeDenyText)
    const next: ChatPermissionPolicyOverride = {}
    if (defaultAction !== baseline.defaultAction) next.defaultAction = defaultAction
    if (readDeny.join("\n") !== baseline.readPathDeny.join("\n")) next.readPathDeny = readDeny
    if (writeDeny.join("\n") !== baseline.writePathDeny.join("\n")) next.writePathDeny = writeDeny
    return Object.keys(next).length === 0 ? null : next
  }

  function handleApply() {
    onApply(buildOverride())
  }

  function handleResetToDefault() {
    onApply(null)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Permissions — {chatTitle}</DialogTitle>
          <DialogBody className="space-y-5">
            <div className="space-y-2">
              <div className="text-sm font-medium">Default action</div>
              <div className="text-xs text-muted-foreground">
                Behaviour when a tool call has no explicit allow/deny rule. <strong>auto-allow</strong> bypasses prompts and runs untrusted shell commands without supervision — use a worktree.
              </div>
              <SegmentedControl
                value={defaultAction}
                onValueChange={handleDefaultActionChange}
                options={[
                  { value: "ask", label: "Ask" },
                  { value: "auto-allow", label: "Auto-allow (unsafe)" },
                  { value: "auto-deny", label: "Auto-deny" },
                ]}
              />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Read-path deny list</div>
              <div className="text-xs text-muted-foreground">
                One glob per line. The model cannot read paths matching any entry. Defaults shown below — edit to add or remove.
              </div>
              <textarea
                value={readDenyText}
                onChange={(event) => storeApi.getState().setReadDenyText(event.target.value)}
                rows={8}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                spellCheck={false}
              />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Write-path deny list</div>
              <div className="text-xs text-muted-foreground">
                One glob per line. The model cannot edit or write paths matching any entry.
              </div>
              <textarea
                value={writeDenyText}
                onChange={(event) => storeApi.getState().setWriteDenyText(event.target.value)}
                rows={8}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                spellCheck={false}
              />
            </div>
          </DialogBody>
          <DialogFooter className="justify-between">
            <Button variant="ghost" onClick={handleResetToDefault}>Reset to defaults</Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onCancel}>Cancel</Button>
              <Button onClick={handleApply}>Apply</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmUnsafeOpen} onOpenChange={(next) => { if (!next) { storeApi.getState().setConfirmUnsafeOpen(false); storeApi.getState().setPendingDefaultAction(null) } }}>
        <DialogContent className="max-w-md">
          <DialogTitle>Enable auto-allow for this chat?</DialogTitle>
          <DialogBody className="space-y-3 text-sm">
            <p>
              Auto-allow disables tool-call prompts. The model can run shell commands, write files, and edit code without
              asking. Read/write deny lists still apply.
            </p>
            <p className="text-warning">Use a worktree for risky tasks.</p>
          </DialogBody>
          <DialogFooter className="justify-end gap-2">
            <Button variant="ghost" onClick={() => { storeApi.getState().setConfirmUnsafeOpen(false); storeApi.getState().setPendingDefaultAction(null) }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const state = storeApi.getState()
                if (pendingDefaultAction) state.setDefaultAction(pendingDefaultAction)
                state.setConfirmUnsafeOpen(false)
                state.setPendingDefaultAction(null)
              }}
            >
              Enable auto-allow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
