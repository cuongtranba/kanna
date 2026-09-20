import { describe, expect, test } from "bun:test"
import { assessChunk, CHUNK_GATE_QUESTIONS, createChunkGate } from "./chunk-gate"
import { createSystemOneClient } from "./system-one.adapter"

const shouldRunLiveTests = process.env.KANNA_RUN_LIVE_CHUNK_GATE_TESTS === "1"
const apiKey = process.env.TYPESAFE_API_KEY ?? ""

const FIXTURES = [
  {
    name: "a completed-item record is not an instruction",
    text: "**Phase 1** (compile + settings + CLI) — done, incl. the two security assertions.",
    kind: "not_instruction",
  },
  {
    name: "a stub that only points at the tracking file is pointer_only",
    text: "Do the next chunk in PROGRESS.md. Verify locally with `bash scripts/verify-decomp.sh`. On success: append a Progress row to PROGRESS.md (chunk done + timestamp) and set the next chunk. On failure: append a Failed-approaches row with a short reason. Terminate when done.",
    kind: "pointer_only",
  },
  {
    name: "an open-ended reduction is too big",
    text: "You are on branch refactor/decompose-large-files. Reduce src/server/agent.ts from 1322 LOC to below 600 LOC by extracting more method clusters into sibling modules. Do as much as possible this run, keep lint and typecheck green, commit and push.",
    kind: "too_big",
  },
  {
    name: "a bounded, specific extraction passes",
    text: "Extract the WS envelope helpers (buildEnvelope, parseEnvelope, ENVELOPE_VERSION) from src/server/ws-router.ts into src/server/ws-router-envelope.ts with a colocated test. Done when ws-router.ts is under 1000 lines and `bun run test src/server/ws-router.test.ts` passes.",
    kind: "ok",
  },
] as const

if (shouldRunLiveTests) {
  describe("live chunk gate against api.typesafe.ai", () => {
    const ask = createSystemOneClient({ apiKey })

    for (const fixture of FIXTURES) {
      test(fixture.name, async () => {
        const response = await ask({ state: { chunk: fixture.text }, questions: CHUNK_GATE_QUESTIONS })
        expect(response).not.toBeNull()
        expect(assessChunk(response?.answers ?? {}).kind).toBe(fixture.kind)
      }, 15_000)
    }

    test("the gate renders one warning per flagged fixture and none for the good one", async () => {
      const gate = createChunkGate({ ask })
      const warnings = await gate.audit(FIXTURES.map((fixture) => ({ label: fixture.name, text: fixture.text })))
      expect(warnings).toHaveLength(3)
      expect(warnings.some((line) => line.startsWith("a bounded, specific extraction passes:"))).toBe(false)
    }, 20_000)
  })
} else {
  test.skip("live chunk gate (set KANNA_RUN_LIVE_CHUNK_GATE_TESTS=1 with TYPESAFE_API_KEY to run)", () => {})
}
