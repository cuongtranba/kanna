import type {
  ChatPermissionPolicy,
  PolicyVerdict,
} from "../shared/permission-policy"

export interface EvaluateArgs {
  toolName: string
  args: Record<string, unknown>
  chatPolicy: ChatPermissionPolicy
  cwd: string
}

export interface EvaluateResult {
  verdict: PolicyVerdict
  reason?: string
}

function argsToText(args: Record<string, unknown>): string {
  return typeof args.command === "string" ? args.command : JSON.stringify(args)
}

export const policy = {
  evaluate(args: EvaluateArgs): EvaluateResult {
    // 1. Deny list wins over everything.
    for (const rule of args.chatPolicy.toolDenyList) {
      if (rule.tool !== args.toolName) continue
      const re = new RegExp(rule.pattern)
      if (re.test(argsToText(args.args))) {
        return { verdict: "auto-deny", reason: `matched denylist: ${rule.pattern}` }
      }
    }
    // 2. Allow list (only meaningful with defaultAction !== "auto-allow")
    for (const rule of args.chatPolicy.toolAllowList) {
      if (rule.tool !== args.toolName) continue
      const re = new RegExp(rule.pattern)
      if (re.test(argsToText(args.args))) {
        return { verdict: "auto-allow", reason: `matched allowlist: ${rule.pattern}` }
      }
    }
    // 3. Default action.
    return { verdict: args.chatPolicy.defaultAction === "ask" ? "ask" : args.chatPolicy.defaultAction }
  },
}
