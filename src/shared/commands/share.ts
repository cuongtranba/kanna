import { z } from "zod"
import { defineCommand, defineCommands, REMOTE_ALLOWED } from "./define"
import { SHARE_CMD_LIST, SHARE_CMD_MINT, SHARE_CMD_REVOKE } from "../session-share/protocol"
import {
  mintRequestSchema,
  revokeRequestSchema,
  shareListRequestSchema,
  shareListResultSchema,
  shareMintResultSchema,
  shareRevokeResultSchema,
} from "../session-share/types.schema"

export const shareCommands = defineCommands(
  defineCommand(SHARE_CMD_MINT, {
    result: shareMintResultSchema,
    params: z.object({ payload: mintRequestSchema }),
    summary: "Create a read-only share link for a chat.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand(SHARE_CMD_REVOKE, {
    result: shareRevokeResultSchema,
    params: z.object({ payload: revokeRequestSchema }),
    summary: "Revoke a share link.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand(SHARE_CMD_LIST, {
    result: shareListResultSchema,
    params: z.object({ payload: shareListRequestSchema }),
    summary: "List the share links of a chat.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
)
