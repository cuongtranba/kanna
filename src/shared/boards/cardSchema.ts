/**
 * The card-field ids the rest of Kanna reads by name.
 *
 * A board's schema is the user's own, and almost every field id in it means
 * nothing outside the board that declared it. These five are the exception:
 * `board-sync.ts` maps a GitHub issue's body, labels, assignee, and URL onto
 * `description` / `labels` / `assignee` / `externalUrl`, and
 * {@link buildStartWorkPrompt} builds an agent's first prompt out of
 * `description` / `acceptanceCriteria` / `labels` / `externalUrl`.
 *
 * So a board that removes one of these — or never creates it — keeps working
 * and quietly does less: issue bodies land nowhere, and the agent starts with a
 * thinner brief. The schema editor SAYS that where the removal happens and
 * allows it anyway, which is how this feature treats every other soft
 * constraint (an unmapped sync column warns, a WIP limit is advisory). Blocking
 * would make the product's conventions unremovable from a board that has
 * neither a tracker nor an agent.
 *
 * The start-work half of this table is checked against the real prompt builder
 * in `cardSchema.test.ts`; the sync half lives in a server module this one may
 * not import, and is pinned by `board-sync.test.ts` instead.
 */
export const LOAD_BEARING_FIELD_NOTES: Readonly<Record<string, string>> = {
  description:
    "GitHub sync writes issue bodies here, and Start work puts it in the agent's first prompt.",
  labels: "GitHub sync writes issue labels here, and Start work puts them in the agent's first prompt.",
  assignee: "GitHub sync writes the issue's assignee here.",
  acceptanceCriteria: "Start work puts this in the agent's first prompt.",
  externalUrl:
    "GitHub sync writes the issue's link here, and Start work puts it in the agent's first prompt.",
}

/** What stops working without this field, or null when nothing does. */
export function loadBearingFieldNote(fieldId: string): string | null {
  return LOAD_BEARING_FIELD_NOTES[fieldId] ?? null
}
