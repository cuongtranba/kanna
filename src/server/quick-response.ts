import { query } from "@anthropic-ai/claude-agent-sdk"
import { CodexAppServerManager } from "./codex-app-server"

type JsonSchema = {
  type: "object"
  properties: Record<string, unknown>
  required?: readonly string[]
  additionalProperties?: boolean
}

export interface StructuredQuickResponseArgs<T> {
  cwd: string
  task: string
  prompt: string
  schema: JsonSchema
  parse: (value: unknown) => T | null
}

interface QuickResponseAdapterArgs {
  codexManager?: CodexAppServerManager
  runClaudeStructured?: (args: Omit<StructuredQuickResponseArgs<unknown>, "parse">) => Promise<unknown | null>
  runCodexStructured?: (args: Omit<StructuredQuickResponseArgs<unknown>, "parse">) => Promise<unknown | null>
}

function parseJsonText(value: string): unknown | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const candidates = [trimmed]
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedMatch?.[1]) {
    candidates.unshift(fencedMatch[1].trim())
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      continue
    }
  }

  return null
}

async function runClaudeStructured(args: Omit<StructuredQuickResponseArgs<unknown>, "parse">): Promise<unknown | null> {
  const q = query({
    prompt: args.prompt,
    options: {
      model: "haiku",
      tools: [],
      systemPrompt: "",
      effort: "low",
      permissionMode: "bypassPermissions",
      outputFormat: {
        type: "json_schema",
        schema: args.schema,
      },
      env: { ...process.env },
    },
  })

  try {
    for await (const message of q) {
      if ("result" in message) {
        return (message as Record<string, unknown>).structured_output ?? null
      }
    }
    return null
  } finally {
    q.close()
  }
}

async function runCodexStructured(
  codexManager: CodexAppServerManager,
  args: Omit<StructuredQuickResponseArgs<unknown>, "parse">
): Promise<unknown | null> {
  const response = await codexManager.generateStructured({
    cwd: args.cwd,
    prompt: `${args.prompt}\n\nReturn JSON only that matches this schema:\n${JSON.stringify(args.schema, null, 2)}`,
  })
  if (typeof response !== "string") return null
  return parseJsonText(response)
}

export class QuickResponseAdapter {
  private readonly codexManager: CodexAppServerManager
  private readonly runClaudeStructured: (args: Omit<StructuredQuickResponseArgs<unknown>, "parse">) => Promise<unknown | null>
  private readonly runCodexStructured: (args: Omit<StructuredQuickResponseArgs<unknown>, "parse">) => Promise<unknown | null>

  constructor(args: QuickResponseAdapterArgs = {}) {
    this.codexManager = args.codexManager ?? new CodexAppServerManager()
    this.runClaudeStructured = args.runClaudeStructured ?? runClaudeStructured
    this.runCodexStructured = args.runCodexStructured ?? ((structuredArgs) =>
      runCodexStructured(this.codexManager, structuredArgs))
  }

  async generateStructured<T>(args: StructuredQuickResponseArgs<T>): Promise<T | null> {
    const request = {
      cwd: args.cwd,
      task: args.task,
      prompt: args.prompt,
      schema: args.schema,
    }

    const claudeResult = await this.tryProvider(args.parse, () => this.runClaudeStructured(request))
    if (claudeResult !== null) return claudeResult

    return await this.tryProvider(args.parse, () => this.runCodexStructured(request))
  }

  private async tryProvider<T>(
    parse: (value: unknown) => T | null,
    run: () => Promise<unknown | null>
  ): Promise<T | null> {
    try {
      const result = await run()
      return result === null ? null : parse(result)
    } catch {
      return null
    }
  }
}
