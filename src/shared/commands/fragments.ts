import { z } from "zod"

export const chatIdShape = { chatId: z.string().describe("Id of the chat") }
export const projectIdShape = { projectId: z.string().describe("Id of the project") }
export const chatIdParams = z.object(chatIdShape)
export const projectIdParams = z.object(projectIdShape)
export const idParams = z.object({ id: z.string() })
