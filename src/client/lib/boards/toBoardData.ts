/**
 * Map Kanna's board snapshot onto `react-kanban-kit`'s flat `BoardData` shape.
 *
 * The library wants one normalised map keyed by id: a `root` whose children are
 * the columns, each column listing its loaded card ids, and every card as a
 * sibling entry. Keeping that translation here — pure and tested — is what lets
 * `KannaBoard` stay a thin render wrapper, and what makes the library
 * replaceable: swapping it is a change to this file plus the wrapper, never to
 * the store, the protocol, or the server.
 *
 * `totalChildrenCount` is the column's REAL total, not `children.length`. That
 * difference is the whole paging contract: the library renders the gap as
 * skeletons and calls `loadMore`, so a 5k-issue import paints immediately.
 *
 * The library's types are imported TYPE-ONLY, so nothing from the package
 * reaches the bundle from here; `KannaBoard` remains its only runtime importer.
 */

import type { BoardData, BoardItem } from "react-kanban-kit"
import { isRecord, type AnyValue } from "../../../shared/errors"
import { isColumnColorToken, type BoardViewSnapshot, type ColumnColorToken } from "../../../shared/boards/types"

export type { BoardData, BoardItem }

export const BOARD_ROOT_ID = "root"

/** The card `type` every card node carries; keys into the library's `configMap`. */
export const CARD_NODE_TYPE = "card"

/**
 * What Kanna stores on a node's `content`.
 *
 * `BoardItem.content` is `any` in the library's types, so it is read back
 * through {@link readNodeContent} rather than dereferenced — otherwise every
 * field access downstream would be untyped.
 */
export interface BoardNodeContent {
  colorToken: ColumnColorToken | null
  wipLimit: number | null
  updatedByAgent: boolean
  projectId: string | null
}

const EMPTY_CONTENT: BoardNodeContent = {
  colorToken: null,
  wipLimit: null,
  updatedByAgent: false,
  projectId: null,
}

export function readNodeContent(item: BoardItem): BoardNodeContent {
  const raw: AnyValue = item.content
  if (!isRecord(raw)) return EMPTY_CONTENT
  const colorToken = typeof raw.colorToken === "string" && isColumnColorToken(raw.colorToken)
    ? raw.colorToken
    : null
  return {
    colorToken,
    wipLimit: typeof raw.wipLimit === "number" ? raw.wipLimit : null,
    updatedByAgent: raw.updatedByAgent === true,
    projectId: typeof raw.projectId === "string" ? raw.projectId : null,
  }
}

export function toBoardData(view: BoardViewSnapshot): BoardData {
  const root: BoardItem = {
    id: BOARD_ROOT_ID,
    title: view.board.title,
    parentId: null,
    children: view.columns.map((column) => column.id),
    totalChildrenCount: view.columns.length,
  }

  const data: BoardData = { root }

  for (const column of view.columns) {
    const cards = view.cards[column.id] ?? []
    const columnContent: BoardNodeContent = {
      colorToken: column.colorToken,
      wipLimit: column.wipLimit,
      updatedByAgent: false,
      projectId: null,
    }
    data[column.id] = {
      id: column.id,
      title: column.title,
      parentId: BOARD_ROOT_ID,
      children: cards.map((card) => card.id),
      // The REAL total, so the library knows how many skeletons to draw.
      totalChildrenCount: view.counts[column.id] ?? cards.length,
      content: columnContent,
    }

    for (const card of cards) {
      const cardContent: BoardNodeContent = {
        colorToken: null,
        wipLimit: null,
        updatedByAgent: card.updatedBy.kind === "agent",
        projectId: card.projectId,
      }
      data[card.id] = {
        id: card.id,
        title: card.title,
        parentId: column.id,
        children: [],
        totalChildrenCount: 0,
        type: CARD_NODE_TYPE,
        content: cardContent,
      }
    }
  }

  return data
}

/**
 * Column colour token to a Tailwind class.
 *
 * A literal lookup rather than `bg-${token}`: Tailwind scans source for
 * complete class names, so an interpolated one is never emitted and the dot
 * renders transparent.
 */
export const COLUMN_DOT_CLASS: Readonly<Record<ColumnColorToken, string>> = {
  "muted-icon": "bg-muted-icon",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
}

/** True when a column holds more cards than its WIP limit allows. Advisory only. */
export function isOverWipLimit(loaded: number, wipLimit: number | null): boolean {
  return wipLimit !== null && loaded > wipLimit
}
