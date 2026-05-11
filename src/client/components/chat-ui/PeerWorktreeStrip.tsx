import type { AgentProvider, ResolvedStackBinding } from "../../../shared/types"

interface PeerWorktreeStripProps {
  bindings: ResolvedStackBinding[]
  provider: AgentProvider | null
  onOpenPath: (path: string) => void
}

export function PeerWorktreeStrip({ bindings, provider, onOpenPath }: PeerWorktreeStripProps) {
  if (bindings.length <= 1) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-0.5">
      {bindings.map((binding) => {
        const label = binding.worktreePath.split("/").pop() ?? binding.worktreePath
        const isPrimary = binding.role === "primary"
        const isMissing = binding.projectStatus === "missing"

        return (
          <div
            key={binding.projectId}
            role="button"
            tabIndex={0}
            className="flex items-center gap-1 cursor-pointer"
            onClick={() => onOpenPath(binding.worktreePath)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onOpenPath(binding.worktreePath)
              }
            }}
          >
            {isPrimary ? (
              <span className="text-emerald-500">●</span>
            ) : (
              <span className="text-muted-foreground">○</span>
            )}
            <span
              className={`font-mono tabular-nums text-xs${isMissing ? " line-through text-muted-foreground" : ""}`}
            >
              {label}
            </span>
          </div>
        )
      })}
      {provider === "codex" && (
        <span className="font-mono text-xs text-muted-foreground ml-2">codex: cwd-only</span>
      )}
    </div>
  )
}
