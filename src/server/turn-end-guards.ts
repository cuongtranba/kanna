import type { DatasetDecl } from "../shared/genui"
import { repairMermaidSource } from "../shared/mermaidRepair"
import type { GenUIDatasetService } from "./genui/dataset-service"
import { isGenUIEnabled } from "./genui/genui-config"
import { createGenUIGuard } from "./genui/genui-guard"
import { createMermaidGuard } from "./mermaid-guard"
import { parseMermaid } from "./mermaid-parse.adapter"
import type { ModelEscalation } from "./model-escalation"
import { composeTurnEndGuards, type TurnEndGuard } from "./turn-end-guard"

export interface CoordinatorTurnEndGuards {
  claude: TurnEndGuard
  codex: TurnEndGuard
}

export function createCoordinatorTurnEndGuards(args: {
  genuiDatasets: GenUIDatasetService | undefined
  buildEscalation: (opts: { name: string; enabled: boolean }) => ModelEscalation
  mermaidGuardEnabled: boolean
}): CoordinatorTurnEndGuards {
  const checkGenUIDataset = async (chatId: string, decl: DatasetDecl) =>
    (args.genuiDatasets ? await args.genuiDatasets.checkResolvable(chatId, decl) : null)
  const genuiEscalation = args.buildEscalation({ name: "genui", enabled: isGenUIEnabled() })
  return {
    codex: createGenUIGuard(genuiEscalation, checkGenUIDataset, false),
    claude: composeTurnEndGuards(
      createMermaidGuard({
        escalation: args.buildEscalation({ name: "mermaid", enabled: args.mermaidGuardEnabled }),
        parse: parseMermaid,
        repair: (source) => {
          const result = repairMermaidSource(source)
          return { source: result.source, repaired: result.repairs.length > 0 }
        },
      }),
      createGenUIGuard(genuiEscalation, checkGenUIDataset, true),
    ),
  }
}
