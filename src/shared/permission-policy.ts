export type ToolRequestStatus =
  | "pending"
  | "answered"
  | "timeout"
  | "canceled"
  | "session_closed"
  | "arg_mismatch"

export const POLICY_TERMINAL_STATUSES: ReadonlySet<ToolRequestStatus> = new Set([
  "answered",
  "timeout",
  "canceled",
  "session_closed",
  "arg_mismatch",
])

export type PolicyVerdict = "auto-allow" | "auto-deny" | "ask"

export interface BashGateConfig {
  autoAllowVerbs: string[]
}

export interface ToolRule {
  tool: string
  /** ECMAScript regex source — no delimiters or flags, passed to `new RegExp(pattern)`. */
  pattern: string
}

export interface ChatPermissionPolicy {
  defaultAction: "ask" | "auto-allow" | "auto-deny"
  bash: BashGateConfig
  readPathDeny: string[]
  writePathDeny: string[]
  toolDenyList: ToolRule[]
  toolAllowList: ToolRule[]
}

export interface ToolRequestDecision {
  kind: "allow" | "deny" | "answer"
  payload?: unknown
  reason?: string
}

export interface ToolRequest {
  id: string
  chatId: string
  sessionId: string
  toolUseId: string
  toolName: string
  arguments: Record<string, unknown>  // MCP tool arguments — arbitrary MCP tool args, unknown shape by design
  canonicalArgsHash: string
  policyVerdict: PolicyVerdict
  status: ToolRequestStatus
  decision?: ToolRequestDecision
  mismatchReason?: string
  createdAt: number
  resolvedAt?: number
  expiresAt: number
}

export const POLICY_DEFAULT: ChatPermissionPolicy = {
  defaultAction: "ask",
  bash: {
    autoAllowVerbs: ["ls", "pwd", "git status", "git diff", "git log"],
  },
  readPathDeny: [
    "~/.ssh",
    "~/.aws",
    "~/.gcp",
    "~/.config/gh",
    "~/.claude",
    "~/.kanna",
    "~/Library/Keychains",
    "/etc/shadow",
    "/etc/sudoers",
    "~/.gnupg",
    "~/.gitconfig",
    "**/.git/config",
    "~/.npmrc",
    "~/.netrc",
    "~/.docker/config.json",
    "**/.env",
    "**/.env.*",
    "**/credentials*",
    "**/*.pem",
    "**/*.key",
    "**/id_rsa*",
    "**/id_ed25519*",
  ],
  writePathDeny: [
    "/etc/**",
    "/usr/**",
    "/System/**",
    "~/.ssh/**",
    "~/.aws/**",
    "~/.config/gh/**",
    "~/.claude/**",
    "~/.kanna/**",
    "~/.gnupg/**",
    "~/.gitconfig",
    "**/.git/config",
  ],
  toolDenyList: [
    { tool: "mcp__kanna__bash", pattern: "rm\\s+-rf\\s+(/|~|\\$HOME)\\b" },
    { tool: "mcp__kanna__bash", pattern: "git\\s+push\\b.*--force" },
  ],
  toolAllowList: [],
}
