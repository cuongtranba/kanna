export interface TonePairing {
  readonly name: string
  readonly fg: string
  readonly bg: string
  readonly alpha: number
  readonly base: string
}

export const TONE_PAIRINGS = [
  { name: "mark/live", fg: "foreground", bg: "card", alpha: 1, base: "card" },
  { name: "mark/idle", fg: "muted-foreground", bg: "card", alpha: 1, base: "card" },
  { name: "mark/attention", fg: "warning-text", bg: "card", alpha: 1, base: "card" },
  { name: "mark/failed", fg: "destructive-text", bg: "card", alpha: 1, base: "card" },
  { name: "ink/success", fg: "success-text", bg: "card", alpha: 1, base: "card" },
  { name: "ink/info", fg: "info-text", bg: "card", alpha: 1, base: "card" },
  { name: "error/api", fg: "destructive-text", bg: "destructive", alpha: 0.1, base: "background" },
  { name: "action/destructive-filled", fg: "destructive-filled-foreground", bg: "destructive-filled", alpha: 1, base: "background" },
] as const satisfies readonly TonePairing[]

export type TonePairingName = (typeof TONE_PAIRINGS)[number]["name"]

export const STATUS_PILL_CLASS: Record<"outdated" | "partial" | "unknown", string> = {
  outdated: "border-warning/40 text-warning-text bg-warning/10",
  partial: "border-warning/40 text-warning-text bg-warning/10",
  unknown: "border-border text-muted-foreground bg-muted/40",
}
