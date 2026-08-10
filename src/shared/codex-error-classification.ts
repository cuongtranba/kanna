/**
 * Vendored from `codex app-server generate-ts` (v2/CodexErrorInfo.ts). The
 * app-server exposes these in camelCase; the snake_case spellings in Codex's
 * own rollout JSONL are a different, internal format — do not mix them.
 */
export type CodexErrorInfo =
  | "contextWindowExceeded"
  | "sessionBudgetExceeded"
  | "usageLimitExceeded"
  | "serverOverloaded"
  | "cyberPolicy"
  | "internalServerError"
  | "unauthorized"
  | "badRequest"
  | "threadRollbackFailed"
  | "sandboxError"
  | "other"
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } }
  | { activeTurnNotSteerable: { turnKind: string } }

export type CodexFailureClass = "transient" | "quota" | "auth" | "fatal" | "unknown"

const FAILURE_CLASS_BY_TAG = {
  serverOverloaded: "transient",
  internalServerError: "transient",
  httpConnectionFailed: "transient",
  responseStreamConnectionFailed: "transient",
  responseStreamDisconnected: "transient",
  responseTooManyFailedAttempts: "transient",
  usageLimitExceeded: "quota",
  sessionBudgetExceeded: "quota",
  unauthorized: "auth",
  contextWindowExceeded: "fatal",
  badRequest: "fatal",
  cyberPolicy: "fatal",
  sandboxError: "fatal",
  threadRollbackFailed: "fatal",
  activeTurnNotSteerable: "fatal",
  other: "unknown",
} as const satisfies Record<string, CodexFailureClass>

export type CodexErrorInfoTag = keyof typeof FAILURE_CLASS_BY_TAG

const OBJECT_VARIANT_TAGS = new Set<string>([
  "httpConnectionFailed",
  "responseStreamConnectionFailed",
  "responseStreamDisconnected",
  "responseTooManyFailedAttempts",
  "activeTurnNotSteerable",
])

function isKnownTag(value: string): value is CodexErrorInfoTag {
  return value in FAILURE_CLASS_BY_TAG
}

export function codexErrorInfoTag(info: CodexErrorInfo | null | undefined): CodexErrorInfoTag | null {
  if (info === null || info === undefined) return null
  if (typeof info === "string") {
    return isKnownTag(info) && !OBJECT_VARIANT_TAGS.has(info) ? info : null
  }
  if (typeof info !== "object") return null
  const keys = Object.keys(info)
  if (keys.length !== 1) return null
  const [key] = keys
  return OBJECT_VARIANT_TAGS.has(key) && isKnownTag(key) ? key : null
}

/**
 * Accepts either a raw protocol payload or a tag already flattened by
 * `codexErrorInfoTag` and persisted on a transcript entry. The stricter
 * `codexErrorInfoTag` rejects an object variant spelled as a bare string,
 * which is right when parsing the wire and wrong when reading back a tag we
 * wrote ourselves.
 */
export type CodexFailureInput = CodexErrorInfo | CodexErrorInfoTag

function resolveTag(value: CodexFailureInput | null | undefined): CodexErrorInfoTag | null {
  if (typeof value === "string") return isKnownTag(value) ? value : null
  return codexErrorInfoTag(value)
}

export function classifyCodexFailure(info: CodexFailureInput | null | undefined): CodexFailureClass {
  const tag = resolveTag(info)
  return tag === null ? "unknown" : FAILURE_CLASS_BY_TAG[tag]
}

export function isRetryableCodexFailure(info: CodexFailureInput | null | undefined): boolean {
  return classifyCodexFailure(info) === "transient"
}

const DESCRIPTION_BY_TAG: Partial<Record<CodexErrorInfoTag, (subject: string) => string>> = {
  serverOverloaded: (subject) =>
    `${subject} is temporarily at capacity. Retry, or switch to another model.`,
  internalServerError: (subject) =>
    `${subject} hit a server-side error. Retrying usually clears it.`,
  httpConnectionFailed: () =>
    "Could not reach the model provider. Check your connection, then retry.",
  responseStreamConnectionFailed: () =>
    "The response stream failed to connect. Retry to start a new stream.",
  responseStreamDisconnected: () =>
    "The response stream disconnected mid-turn. Retry to pick up from where it stopped.",
  responseTooManyFailedAttempts: (subject) =>
    `${subject} failed repeatedly while streaming. Retry, or switch to another model.`,
  usageLimitExceeded: () =>
    "You have reached your Codex usage limit. Access returns when the limit window resets.",
  sessionBudgetExceeded: () =>
    "This session reached its configured token budget.",
  unauthorized: () =>
    "Codex rejected the credentials for this request. Re-authenticate with `codex login`.",
  contextWindowExceeded: (subject) =>
    `The conversation no longer fits in ${subject}'s context window. Start a new chat or compact this one.`,
  badRequest: () =>
    "Codex rejected the request as malformed.",
  cyberPolicy: () =>
    "Codex declined this request under its usage policy.",
  sandboxError: () =>
    "The Codex sandbox failed to run the requested command.",
  threadRollbackFailed: () =>
    "Codex could not roll the conversation back to the requested point.",
  activeTurnNotSteerable: () =>
    "The running turn cannot accept new input. Wait for it to finish, or stop it.",
}

const GENERIC_SUBJECT = "The selected model"

export function describeCodexFailure(
  info: CodexFailureInput | null | undefined,
  model: string | null,
): string | null {
  const tag = resolveTag(info)
  if (tag === null) return null
  const describe = DESCRIPTION_BY_TAG[tag]
  if (describe === undefined) return null
  return describe(model ?? GENERIC_SUBJECT)
}
