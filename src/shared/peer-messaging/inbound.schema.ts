import { z } from "zod"
import { PEER_INBOUND_MODES } from "./inbound"

export const peerInboundModeSchema = z.enum(PEER_INBOUND_MODES)
