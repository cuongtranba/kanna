import { query } from "@anthropic-ai/claude-agent-sdk"
import { homedir } from "node:os"
import OpenAI from "openai"
import { getDataRootDir } from "../shared/branding"
import type { LlmProviderSnapshot } from "../shared/types"
import { ClaudeAuthErrorDetector } from "./auto-continue/auth-error-detector"
import { ClaudeLimitDetector } from "./auto-continue/limit-detector"
import { CodexAppServerManager } from "./codex-app-server"
import { readLlmProviderSnapshot } from "./llm-provider"
import type { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"

let activeOAuthPool: OAuthTokenPool | null = null

export function setQuickResponseOAuthPool(pool: OAuthTokenPool | null) {
  activeOAuthPool = pool
}

const CLAUDE_STRUCTURED_TIMEOUT_MS = 60_000

const CLAUDE_RATE_LIMIT_PATTERNS = [
  /you'?ve hit your limit/i,
  /rate.?limit/i,
  /usage limit/i,
  /resets? \d/i,
] as const

function isClaudeRateLimitMessage(message: string): boolean {
  return CLAUDE_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))
}

// Env vars set by a parent Claude Code session. The Agent SDK refuses to
// spawn a child Claude Code process when these are present ("Claude Code
// cannot be launched inside another Claude Code session"), so strip them
// before forwarding env to the SDK. Auth still resolves via macOS keychain
// or ANTHROPIC_API_KEY.
const NESTED_CLAUDE_CODE_ENV_KEYS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_AGENT_SDK_VERSION",
  "AI_AGENT",
] as const

export function envWithoutParentClaudeCode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = { ...env }
  for (const key of NESTED_CLAUDE_CODE_ENV_KEYS) {
    delete cleaned[key]
  }
  return cleaned
}

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
  readLlmProvider?: () => Promise<LlmProviderSnapshot>
  runOpenAIStructured?: (
    config: LlmProviderSnapshot,
    args: Omit<StructuredQuickResponseArgs<unknown>, "parse">
  ) => Promise<unknown | null>
  runClaudeStructured?: (args: Omit<StructuredQuickResponseArgs<unknown>, "parse">) => Promise<unknown | null>
  runCodexStructured?: (args: Omit<StructuredQuickResponseArgs<unknown>, "parse">) => Promise<unknown | null>
}

export interface StructuredQuickResponseFailure {
  provider: "openai" | "claude" | "codex"
  reason: string
}

export interface StructuredQuickResponseResult<T> {
  value: T | null
  failures: StructuredQuickResponseFailure[]
}

export function getQuickResponseWorkspace(env: Record<string, string | undefined> = process.env) {
  return getDataRootDir(homedir(), env)
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

function structuredOutputFromSdkMessage(message: unknown): unknown | null {
  if (!message || typeof message !== "object") return null

  const record = message as Record<string, unknown>
  if (record.type === "result") {
    return record.structured_output ?? null
  }

  const assistantMessage = record.message
  if (!assistantMessage || typeof assistantMessage !== "object") return null
  const content = (assistantMessage as { content?: unknown }).content
  if (!Array.isArray(content)) return null

  for (const item of content) {
    if (!item || typeof item !== "object") continue
    const toolUse = item as Record<string, unknown>
    if (toolUse.type === "tool_use" && toolUse.name === "StructuredOutput") {
      return toolUse.input ?? null
    }
  }

  return null
}

export async function runClaudeStructured(args: Omit<StructuredQuickResponseArgs<unknown>, "parse">): Promise<unknown | null> {
  const pool = activeOAuthPool
  const picked = pool?.pickActive() ?? null
  // Refuse to spawn when the pool has tokens but none are currently usable
  // (all reserved, limited, errored, or disabled). Without this, env-less
  // spawn would silently fall back to the CLI keychain auth path which
  // typically holds a stale `claude /login` token → opaque 401 loops.
  if (pool && pool.hasAnyToken() && !picked) {
    console.warn("[quick-response] no usable OAuth token in pool; skipping claude provider")
    return null
  }
  if (picked && pool) pool.markUsed(picked.id)
  const env = envWithoutParentClaudeCode(process.env)
  if (picked) env.CLAUDE_CODE_OAUTH_TOKEN = picked.token

  const detector = new ClaudeLimitDetector()
  let detectedLimit: { resetAt: number; tz: string } | null = null

  const q = query({
    prompt: args.prompt,
    options: {
      cwd: args.cwd,
      model: "claude-haiku-4-5-20251001",
      tools: [],
      systemPrompt: "",
      effort: "low",
      permissionMode: "bypassPermissions",
      outputFormat: {
        type: "json_schema",
        schema: args.schema,
      },
      env,
    },
  })

  try {
    const result = await Promise.race<unknown | null>([
      (async () => {
        for await (const message of q) {
          if (message && typeof message === "object" && (message as { type?: string }).type === "rate_limit_event") {
            const detection = detector.detectFromSdkRateLimitInfo("", (message as { rate_limit_info?: unknown }).rate_limit_info)
            if (detection) {
              detectedLimit = { resetAt: detection.resetAt, tz: detection.tz }
            }
          }
          const structuredOutput = structuredOutputFromSdkMessage(message)
          if (structuredOutput !== null) {
            return structuredOutput
          }
        }
        return null
      })(),
      new Promise<null>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Claude structured response timed out after ${CLAUDE_STRUCTURED_TIMEOUT_MS}ms`))
        }, CLAUDE_STRUCTURED_TIMEOUT_MS)
      }),
    ])

    return result
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const errorLimit = detector.detectFromResultText("", reason)
    const rateLimited = Boolean(detectedLimit) || errorLimit !== null || isClaudeRateLimitMessage(reason)
    if (rateLimited) {
      console.log(`[quick-response] claude rate-limited, falling back: ${reason}`)
      if (picked && pool) {
        const limit = detectedLimit ?? (errorLimit ? { resetAt: errorLimit.resetAt, tz: errorLimit.tz } : null)
        // Fallback window when we can't parse the precise reset: 5 minutes.
        const resetAt = limit?.resetAt ?? Date.now() + 5 * 60_000
        pool.markLimited(picked.id, resetAt)
      }
    } else {
      const authDetection = new ClaudeAuthErrorDetector().detect("", error)
      if (authDetection && picked && pool) {
        // Token rejected by Anthropic (401). Mark it errored so the next
        // pickActive() skips it — otherwise quick-response would keep
        // selecting the same dead token by lastUsedAt ordering and burn
        // every subsequent call on the same 401.
        console.warn(`[quick-response] claude auth error, marking token ${picked.id} errored: ${reason}`)
        pool.markError(picked.id, authDetection.reason)
      } else {
        console.warn(`[quick-response] claude structured request failed: ${reason}`)
      }
    }
    return null
  } finally {
    try {
      q.close()
    } catch {
      // Ignore close failures on timed-out or failed quick responses.
    }
  }
}

export async function runOpenAIStructured(
  config: LlmProviderSnapshot,
  args: Omit<StructuredQuickResponseArgs<unknown>, "parse">
): Promise<unknown | null> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.resolvedBaseUrl,
  })

  const response = await client.responses.create({
    model: config.model,
    input: args.prompt,
    text: {
      format: {
        type: "json_schema",
        name: "quick_response",
        schema: args.schema,
        strict: true,
      },
    },
  })

  return parseJsonText(response.output_text)
}

export async function runCodexStructured(
  codexManager: CodexAppServerManager,
  args: Omit<StructuredQuickResponseArgs<unknown>, "parse">
): Promise<unknown | null> {
  const response = await codexManager.generateStructured({
    cwd: args.cwd,
    model: "gpt-5.4-mini",
    prompt: `${args.prompt}\n\nReturn JSON only that matches this schema:\n${JSON.stringify(args.schema, null, 2)}`,
  })
  if (typeof response !== "string") return null
  return parseJsonText(response)
}

export class QuickResponseAdapter {
  private readonly codexManager: CodexAppServerManager
  private readonly readLlmProvider: () => Promise<LlmProviderSnapshot>
  private readonly runOpenAIStructured: (
    config: LlmProviderSnapshot,
    args: Omit<StructuredQuickResponseArgs<unknown>, "parse">
  ) => Promise<unknown | null>
  private readonly runClaudeStructured: (args: Omit<StructuredQuickResponseArgs<unknown>, "parse">) => Promise<unknown | null>
  private readonly runCodexStructured: (args: Omit<StructuredQuickResponseArgs<unknown>, "parse">) => Promise<unknown | null>

  constructor(args: QuickResponseAdapterArgs = {}) {
    this.codexManager = args.codexManager ?? new CodexAppServerManager()
    this.readLlmProvider = args.readLlmProvider ?? (() => readLlmProviderSnapshot())
    this.runOpenAIStructured = args.runOpenAIStructured ?? runOpenAIStructured
    this.runClaudeStructured = args.runClaudeStructured ?? runClaudeStructured
    this.runCodexStructured = args.runCodexStructured ?? ((structuredArgs) =>
      runCodexStructured(this.codexManager, structuredArgs))
  }
  async generateStructured<T>(args: StructuredQuickResponseArgs<T>): Promise<T | null> {
    const result = await this.generateStructuredWithDiagnostics(args)
    return result.value
  }

  async generateStructuredWithDiagnostics<T>(args: StructuredQuickResponseArgs<T>): Promise<StructuredQuickResponseResult<T>> {
    const request = {
      cwd: getQuickResponseWorkspace(),
      task: args.task,
      prompt: args.prompt,
      schema: args.schema,
    }

    const failures: StructuredQuickResponseFailure[] = []
    const llmProvider = await this.readLlmProvider()
    if (llmProvider.enabled) {
      const openAIResult = await this.tryProvider("openai", args.task, args.parse, () => this.runOpenAIStructured(llmProvider, request))
      if (openAIResult.value !== null) {
        return {
          value: openAIResult.value,
          failures,
        }
      }
      if (openAIResult.failure) {
        failures.push(openAIResult.failure)
      }
    }

    const claudeResult = await this.tryProvider("claude", args.task, args.parse, () => this.runClaudeStructured(request))
    if (claudeResult.value !== null) {
      return {
        value: claudeResult.value,
        failures,
      }
    }
    if (claudeResult.failure) {
      failures.push(claudeResult.failure)
    }

    const codexResult = await this.tryProvider("codex", args.task, args.parse, () => this.runCodexStructured(request))
    if (codexResult.value !== null) {
      return {
        value: codexResult.value,
        failures,
      }
    }
    if (codexResult.failure) {
      failures.push(codexResult.failure)
    }

    return {
      value: null,
      failures,
    }
  }

  private async tryProvider<T>(
    provider: "openai" | "claude" | "codex",
    task: string,
    parse: (value: unknown) => T | null,
    run: () => Promise<unknown | null>
  ): Promise<{ value: T | null; failure: StructuredQuickResponseFailure | null }> {
    try {
      const result = await run()
      if (result === null) {
        return {
          value: null,
          failure: {
            provider,
            reason: `${provider} returned no result for ${task}`,
          },
        }
      }

      const parsed = parse(result)
      if (parsed === null) {
        return {
          value: null,
          failure: {
            provider,
            reason: `${provider} returned invalid structured output for ${task}`,
          },
        }
      }

      return {
        value: parsed,
        failure: null,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        value: null,
        failure: {
          provider,
          reason: `${provider} failed ${task}: ${message}`,
        },
      }
    }
  }
}
