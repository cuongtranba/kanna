import * as zod from "zod"
import { defineRpc } from "./plugin-rpc-protocol"

export const SERVER_HOST_MODULE_TABLE: Readonly<Record<string, () => object>> = {
  "@kanna/plugin/server": () => ({ defineRpc }),
  zod: () => zod,
}

export const SERVER_HOST_MODULES: readonly string[] = Object.keys(SERVER_HOST_MODULE_TABLE)
