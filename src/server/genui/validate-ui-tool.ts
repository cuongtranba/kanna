import { tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { formatGenUIIssues, type DatasetDecl } from "../../shared/genui"
import { fail, ok, type ToolResult } from "../kanna-mcp-tool"
import { resolveDatasetFile } from "./dataset-file.adapter"
import { reviewGenUISpec } from "./genui-guard"

export const VALIDATE_UI_DESCRIPTION =
  "Check a Kanna generative-UI spec BEFORE you put it in a ```kanna-ui fence. "
  + "Pass the JSON object without the fence. A rejection lists every problem by path: "
  + "unknown components or actions, props of the wrong type, dataset metrics that do not exist, "
  + "and file datasets that are missing or outside the working directory. Cheap — call it for every view."

export const validateUiInputShape = {
  spec: z.string().describe("The complete spec JSON, without the surrounding ``` fence."),
}

export async function runValidateUi(
  source: string,
  checkDataset: (decl: DatasetDecl) => Promise<string | null>,
): Promise<ToolResult> {
  const review = await reviewGenUISpec(source, checkDataset)
  if (review.issues.length === 0) return ok("VALID")
  return fail(`INVALID — fix these and validate again:\n${formatGenUIIssues(review.issues)}`)
}

export async function checkFileDatasetInCwd(cwd: string, decl: DatasetDecl): Promise<string | null> {
  if (decl.source !== "file") return null
  const resolved = await resolveDatasetFile(cwd, decl.path)
  if (resolved.ok) return null
  return resolved.reason === "outside_root"
    ? `"${decl.path}" resolves outside the working directory`
    : `"${decl.path}" does not exist in ${cwd} — embed the rows inline instead, or point at a file that exists`
}

export function buildValidateUiToolList(chatId: string | null, cwd: string) {
  if (!chatId) return []
  return [
    tool("validate_ui", VALIDATE_UI_DESCRIPTION, validateUiInputShape, async (input) =>
      await runValidateUi(input.spec, (decl) => checkFileDatasetInCwd(cwd, decl))),
  ]
}
