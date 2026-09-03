import type { output as ZodOutput } from "zod"
import { greeting } from "./greeting.shared"

export const SERVER_ONLY_MARKER = "HELLO_SERVER_ONLY_MARKER"

export function createGreeting({ name }: ZodOutput<typeof greeting.input>) {
  return { message: `Hello, ${name}` }
}
