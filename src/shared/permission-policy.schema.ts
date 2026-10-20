import { z } from "zod"
import type { ChatPermissionPolicyOverride, ToolRequestDecision } from "./permission-policy"
import { jsonValueSchema } from "./genui/json-schema"
import { assertParity } from "./type-parity"

export const chatPermissionPolicyOverrideSchema = z.object({
  defaultAction: z.enum(["ask", "auto-allow", "auto-deny"]).optional(),
  readPathDeny: z.array(z.string()).optional(),
  writePathDeny: z.array(z.string()).optional(),
})

export const toolRequestDecisionSchema = z.object({
  kind: z.enum(["allow", "deny", "answer"]),
  payload: jsonValueSchema.optional(),
  reason: z.string().optional(),
})

assertParity<z.output<typeof chatPermissionPolicyOverrideSchema>, ChatPermissionPolicyOverride>()
assertParity<z.output<typeof toolRequestDecisionSchema>, ToolRequestDecision>()
