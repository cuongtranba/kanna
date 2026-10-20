import { z } from "zod"
import type { BeaconConfig, BeaconMintResult, BeaconPatch, BeaconUpdateResult } from "./beacon-config"
import type { BeaconOs } from "./beacon-protocol"
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

export const beaconOsSchema = z.enum(["darwin", "linux", "windows"])

export const beaconConfigSchema = z.object({
  id: z.string(),
  label: z.string(),
  alias: z.string().optional(),
  publicKey: z.string(),
  os: beaconOsSchema,
  scope: beaconScopeSchema,
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const beaconMintResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), code: z.string(), expiresAt: z.number() }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

export const beaconUpdateResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

export const beaconPatchSchema = z.object({
  label: z.string().optional(),
  alias: z.string().nullable().optional(),
  scope: beaconScopeSchema.optional(),
  enabled: z.boolean().optional(),
})

assertParity<z.output<typeof beaconScopeSchema>, BeaconScope>()
assertParity<z.output<typeof beaconPatchSchema>, BeaconPatch>()
assertParity<z.output<typeof beaconOsSchema>, BeaconOs>()
assertParity<z.output<typeof beaconConfigSchema>, BeaconConfig>()
assertParity<z.output<typeof beaconMintResultSchema>, BeaconMintResult>()
assertParity<z.output<typeof beaconUpdateResultSchema>, BeaconUpdateResult>()
