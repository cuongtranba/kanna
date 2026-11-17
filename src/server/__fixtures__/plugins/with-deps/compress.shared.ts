import { defineRpc } from "@kanna/plugin/server"
import { z } from "zod"

export const compress = defineRpc({
  name: "compress.roundTrip",
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string(), marker: z.string() }),
})
