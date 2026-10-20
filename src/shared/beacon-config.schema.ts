import { z } from "zod"
import type { BeaconPatch } from "./beacon-config"
import type { BeaconScope } from "./beacon-scope"
import { assertParity } from "./type-parity"

export const beaconScopeSchema = z.object({
  exec: z.boolean(),
  execAllowlist: z.array(z.string()).readonly(),
  autoRunScripts: z.boolean(),
  trustedScriptHashes: z.array(z.string()).readonly(),
  readRoots: z.array(z.string()).readonly(),
  writeRoots: z.array(z.string()).readonly(),
  perCallTimeoutMs: z.number(),
  outputByteCap: z.number(),
  maxConcurrent: z.number(),
})

export const beaconPatchSchema = z.object({
  label: z.string().optional(),
  alias: z.string().nullable().optional(),
  scope: beaconScopeSchema.optional(),
  enabled: z.boolean().optional(),
})

assertParity<z.output<typeof beaconScopeSchema>, BeaconScope>()
assertParity<z.output<typeof beaconPatchSchema>, BeaconPatch>()
