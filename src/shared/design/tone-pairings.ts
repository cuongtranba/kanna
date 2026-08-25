export interface TonePairing {
  readonly name: string
  readonly fg: string
  readonly bg: string
  readonly alpha: number
  readonly base: string
}

export const TONE_PAIRINGS = [
  { name: "status/running", fg: "warning-text", bg: "warning", alpha: 0.1, base: "card" },
  { name: "status/completed", fg: "success-text", bg: "success", alpha: 0.1, base: "card" },
  { name: "status/failed", fg: "destructive-text", bg: "destructive", alpha: 0.1, base: "card" },
  { name: "status/skipped", fg: "muted-foreground", bg: "muted", alpha: 0.4, base: "card" },
  { name: "error/api", fg: "destructive-text", bg: "destructive", alpha: 0.1, base: "background" },
  { name: "action/destructive-filled", fg: "destructive-filled-foreground", bg: "destructive-filled", alpha: 1, base: "background" },
] as const satisfies readonly TonePairing[]

export type TonePairingName = (typeof TONE_PAIRINGS)[number]["name"]

export const STATUS_PILL_CLASS = {
  running: "border-warning/40 text-warning-text bg-warning/10",
  completed: "border-success/40 text-success-text bg-success/10",
  failed: "border-destructive/40 text-destructive-text bg-destructive/10",
  skipped: "border-border text-muted-foreground bg-muted/40",
} as const
