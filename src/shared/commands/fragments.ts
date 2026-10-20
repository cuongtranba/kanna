import { z } from "zod"

export const chatIdShape = { chatId: z.string() }
export const projectIdShape = { projectId: z.string() }
export const chatIdParams = z.object(chatIdShape)
export const projectIdParams = z.object(projectIdShape)
export const idParams = z.object({ id: z.string() })
