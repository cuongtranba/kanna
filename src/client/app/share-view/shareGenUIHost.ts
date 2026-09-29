import { datasetFreezeKey, runDatasetQuery, type DatasetDecl, type DatasetQuery } from "../../../shared/genui"
import type { DatasetQueryOutcome } from "../../../shared/genui/protocol"
import type { FrozenDataset } from "../../../shared/session-share/types"
import { domAdapter } from "../../adapters/dom.adapter"
import { READONLY_GENUI_HOST, type GenUIHost } from "../../components/genui/host"

const NOT_CAPTURED = "This data was not captured when the chat was shared. Share the chat again to include it."

function answerFromFrozen(frozen: FrozenDataset | undefined, decl: DatasetDecl, query: DatasetQuery): DatasetQueryOutcome {
  if (!frozen) return { status: "error", code: "source_unavailable", message: NOT_CAPTURED }
  if (frozen.status === "unavailable") return { status: "error", code: "source_unavailable", message: frozen.message }
  const outcome = runDatasetQuery(decl, frozen.rows, query)
  if (!outcome.ok) return { status: "error", code: "invalid_query", message: outcome.message }
  return { status: "ok", result: outcome.result, revision: "shared", fetchedAt: 0 }
}

export function createShareGenUIHost(datasets: Readonly<Record<string, FrozenDataset>>): GenUIHost {
  return {
    ...READONLY_GENUI_HOST,
    queryDataset: (decl, query) => Promise.resolve(answerFromFrozen(datasets[datasetFreezeKey(decl)], decl, query)),
    openLink: (url) => domAdapter.openWindow(url, "_blank", "noopener,noreferrer"),
  }
}
