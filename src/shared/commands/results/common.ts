import { z } from "zod"

export const okResultSchema = z.object({ ok: z.literal(true) })
