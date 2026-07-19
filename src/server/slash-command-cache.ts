import type { SlashCommand } from "../shared/types"

/**
 * Per-cwd cache of the RAW CLI slash-command list (built-ins + plugins, before
 * the local-catalog merge). CLI commands depend only on the cwd (project +
 * user + plugin scope), not on the chat — so the first chat in a project pays
 * the one ephemeral `claude` spawn and every sibling chat reuses the result.
 * This removes the fragile spawn-per-brand-new-chat path (the observed
 * eternal-loading trigger).
 *
 * Process-lifetime, in-memory only (cleared on restart). A short TTL lets a
 * newly-installed plugin/command surface without a restart. `now` is injected
 * so tests stay deterministic; `Date.now` is a host global (not part of the
 * side-effect seal).
 */
export class SlashCommandCache {
  private readonly byCwd = new Map<string, { commands: SlashCommand[]; expiresAt: number }>()

  constructor(
    private readonly ttlMs: number = 5 * 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(cwd: string): SlashCommand[] | null {
    const row = this.byCwd.get(cwd)
    if (!row) return null
    if (row.expiresAt <= this.now()) {
      this.byCwd.delete(cwd)
      return null
    }
    return row.commands
  }

  set(cwd: string, commands: SlashCommand[]): void {
    // Never cache an empty list — an empty result is a failed/degraded fetch,
    // not a real "this cwd has no commands"; caching it would pin the picker
    // empty until the TTL expires.
    if (commands.length === 0) return
    this.byCwd.set(cwd, { commands, expiresAt: this.now() + this.ttlMs })
  }

  clear(): void {
    this.byCwd.clear()
  }
}
