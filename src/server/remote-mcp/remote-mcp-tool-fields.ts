import { z } from "zod"
import { DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS } from "./remote-mcp-follow-view"

export const IDEMPOTENCY_KEY_FIELD = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe("A stable string for this user request. Repeating the call with the same key returns the original chat without starting new work")

export const WAIT_FIELD = z.boolean().optional().describe("Wait for the turn to finish (default true). False returns right after the message is accepted")

export const TIMEOUT_SECONDS_FIELD = z
  .number()
  .int()
  .min(1)
  .max(MAX_WAIT_SECONDS)
  .optional()
  .describe(`Longest wait in seconds (default ${DEFAULT_WAIT_SECONDS}, max ${MAX_WAIT_SECONDS}; shorter on connections that cannot stream progress)`)
