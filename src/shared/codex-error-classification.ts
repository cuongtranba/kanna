import { assertParity } from "./type-parity"

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

interface CodexErrorTagSpec {
  readonly failureClass: CodexFailureClass
  readonly shape: "string" | "object"
  readonly describe: ((subject: string) => string) | null
}

const CODEX_ERROR_TAGS = {
  serverOverloaded: {
    failureClass: "transient",
    shape: "string",
    describe: (subject: string) => `${subject} is temporarily at capacity. Retry, or switch to another model.`,
  },
  internalServerError: {
    failureClass: "transient",
    shape: "string",
    describe: (subject: string) => `${subject} hit a server-side error. Retrying usually clears it.`,
  },
  httpConnectionFailed: {
    failureClass: "transient",
    shape: "object",
    describe: () => "Could not reach the model provider. Check your connection, then retry.",
  },
  responseStreamConnectionFailed: {
    failureClass: "transient",
    shape: "object",
    describe: () => "The response stream failed to connect. Retry to start a new stream.",
  },
  responseStreamDisconnected: {
    failureClass: "transient",
    shape: "object",
    describe: () => "The response stream disconnected mid-turn. Retry to pick up from where it stopped.",
  },
  responseTooManyFailedAttempts: {
    failureClass: "transient",
    shape: "object",
    describe: (subject: string) => `${subject} failed repeatedly while streaming. Retry, or switch to another model.`,
  },
  usageLimitExceeded: {
    failureClass: "quota",
    shape: "string",
    describe: () => "You have reached your Codex usage limit. Access returns when the limit window resets.",
  },
  sessionBudgetExceeded: {
    failureClass: "quota",
    shape: "string",
    describe: () => "This session reached its configured token budget.",
  },
  unauthorized: {
    failureClass: "auth",
    shape: "string",
    describe: () => "Codex rejected the credentials for this request. Re-authenticate with `codex login`.",
  },
  contextWindowExceeded: {
    failureClass: "fatal",
    shape: "string",
    describe: (subject: string) =>
      `The conversation no longer fits in ${subject}'s context window. Start a new chat or compact this one.`,
  },
  badRequest: {
    failureClass: "fatal",
    shape: "string",
    describe: () => "Codex rejected the request as malformed.",
  },
  cyberPolicy: {
    failureClass: "fatal",
    shape: "string",
    describe: () => "Codex declined this request under its usage policy.",
  },
  sandboxError: {
    failureClass: "fatal",
    shape: "string",
    describe: () => "The Codex sandbox failed to run the requested command.",
  },
  threadRollbackFailed: {
    failureClass: "fatal",
    shape: "string",
    describe: () => "Codex could not roll the conversation back to the requested point.",
  },
  activeTurnNotSteerable: {
    failureClass: "fatal",
    shape: "object",
    describe: () => "The running turn cannot accept new input. Wait for it to finish, or stop it.",
  },
  other: {
    failureClass: "unknown",
    shape: "string",
    describe: null,
  },
} as const satisfies Record<string, CodexErrorTagSpec>

export type CodexErrorInfoTag = keyof typeof CODEX_ERROR_TAGS

type TagsOfShape<S extends CodexErrorTagSpec["shape"]> = {
  [K in CodexErrorInfoTag]: (typeof CODEX_ERROR_TAGS)[K]["shape"] extends S ? K : never
}[CodexErrorInfoTag]

type ObjectVariantKey<T> = T extends object ? keyof T : never

assertParity<TagsOfShape<"string">, Extract<CodexErrorInfo, string>>()
assertParity<TagsOfShape<"object">, ObjectVariantKey<CodexErrorInfo>>()

function isKnownTag(value: string): value is CodexErrorInfoTag {
  return Object.hasOwn(CODEX_ERROR_TAGS, value)
}

function hasShape(tag: CodexErrorInfoTag, shape: CodexErrorTagSpec["shape"]): boolean {
  return CODEX_ERROR_TAGS[tag].shape === shape
}

export function codexErrorInfoTag(info: CodexErrorInfo | null | undefined): CodexErrorInfoTag | null {
  if (info === null || info === undefined) return null
  if (typeof info === "string") {
    return isKnownTag(info) && hasShape(info, "string") ? info : null
  }
  if (typeof info !== "object") return null
  const keys = Object.keys(info)
  if (keys.length !== 1) return null
  const [key] = keys
  return isKnownTag(key) && hasShape(key, "object") ? key : null
}

export type CodexFailureInput = CodexErrorInfo | CodexErrorInfoTag

function resolveTag(value: CodexFailureInput | null | undefined): CodexErrorInfoTag | null {
  if (typeof value === "string") return isKnownTag(value) ? value : null
  return codexErrorInfoTag(value)
}

export function classifyCodexFailure(info: CodexFailureInput | null | undefined): CodexFailureClass {
  const tag = resolveTag(info)
  return tag === null ? "unknown" : CODEX_ERROR_TAGS[tag].failureClass
}

export function isRetryableCodexFailure(info: CodexFailureInput | null | undefined): boolean {
  return classifyCodexFailure(info) === "transient"
}

const GENERIC_SUBJECT = "The selected model"

export function describeCodexFailure(
  info: CodexFailureInput | null | undefined,
  model: string | null,
): string | null {
  const tag = resolveTag(info)
  if (tag === null) return null
  const describe: CodexErrorTagSpec["describe"] = CODEX_ERROR_TAGS[tag].describe
  return describe === null ? null : describe(model ?? GENERIC_SUBJECT)
}
