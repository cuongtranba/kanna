import { defineRpc } from "@kanna/plugin/server"
import { z } from "zod"

export const greeting = defineRpc({
  name: "greeting.create",
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
})
