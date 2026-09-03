export interface TonePairing {
  readonly name: string
  readonly fg: string
  readonly bg: string
  readonly alpha: number
  readonly base: string
}

export const TONE_PAIRINGS = [
  // Marks sit on the PLAIN surface, not on a tint. The four `status/*` tinted
  // pills these replaced were the only consumers of those pairings, so keeping
  // them would have left the contrast test proving something nothing renders —
  // a check that gates nothing. These measure what is actually drawn.
  { name: "mark/live", fg: "foreground", bg: "card", alpha: 1, base: "card" },
  { name: "mark/idle", fg: "muted-foreground", bg: "card", alpha: 1, base: "card" },
  { name: "mark/attention", fg: "warning-text", bg: "card", alpha: 1, base: "card" },
  { name: "mark/failed", fg: "destructive-text", bg: "card", alpha: 1, base: "card" },
  { name: "error/api", fg: "destructive-text", bg: "destructive", alpha: 0.1, base: "background" },
  { name: "action/destructive-filled", fg: "destructive-filled-foreground", bg: "destructive-filled", alpha: 1, base: "background" },
] as const satisfies readonly TonePairing[]

export type TonePairingName = (typeof TONE_PAIRINGS)[number]["name"]

/**
 * Tinted pill classes, for the one context that still wants a pill: package
 * update availability in Settings.
 *
 * That is not a run state — a turn's lifecycle is drawn as a mark now (see
 * `stateMark.ts`) — and Settings is a low-density surface where a pill reads
 * well. The four run-state keys that used to live here went with the pills
 * they painted.
 *
 * Typed against the availability values that actually render, so `up_to_date`
 * (which draws no pill) cannot be indexed and a new value cannot be forgotten.
 */
export const STATUS_PILL_CLASS: Record<"outdated" | "partial" | "unknown", string> = {
  outdated: "border-warning/40 text-warning-text bg-warning/10",
  partial: "border-warning/40 text-warning-text bg-warning/10",
  unknown: "border-border text-muted-foreground bg-muted/40",
}
