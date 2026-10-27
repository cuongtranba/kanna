import type { LexicalNode } from "lexical"
import type { MultilineElementTransformer } from "@lexical/markdown"
import { FENCE_END_REGEX, scanFenceBody } from "../../../../shared/markdown-fences"
import {
  fenceBlock,
  KANNA_UI_FENCE_LANGUAGE,
  KANNA_UI_FENCE_START_REGEX,
  KANNA_UI_INTENT_FENCE_LANGUAGE,
  KANNA_UI_INTENT_FENCE_START_REGEX,
} from "../../../../shared/genui/fences"
import { $createKannaUiNode, KannaUiNode } from "../nodes/KannaUiNode"

function kannaUiFence(startRegex: RegExp, intent: boolean): MultilineElementTransformer {
  return {
    type: "multiline-element",
    dependencies: [KannaUiNode],
    regExpStart: startRegex,
    regExpEnd: { optional: true, regExp: FENCE_END_REGEX },
    handleImportAfterStartMatch({ lines, rootNode, startLineIndex, startMatch }) {
      const { source, lastLineIndex, closed } = scanFenceBody(lines, startLineIndex, startMatch[1] ?? "```")
      rootNode.append($createKannaUiNode(source, closed, intent))
      return [true, lastLineIndex]
    },
    replace(): boolean | void {
      return false
    },
    export(node: LexicalNode): string | null {
      if (!(node instanceof KannaUiNode) || node.isIntent() !== intent) return null
      return fenceBlock(intent ? KANNA_UI_INTENT_FENCE_LANGUAGE : KANNA_UI_FENCE_LANGUAGE, node.getTextContent())
    },
  }
}

export const KANNA_UI_FENCE = kannaUiFence(KANNA_UI_FENCE_START_REGEX, false)

export const KANNA_UI_INTENT_FENCE = kannaUiFence(KANNA_UI_INTENT_FENCE_START_REGEX, true)
