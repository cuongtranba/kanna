import type { Admission } from "./webhook-registry"

export function jsonReject(status: number, error: string, headers?: Record<string, string>): Response {
  return Response.json({ ok: false, error }, { status, headers })
}

export function admissionResponse(admission: Admission): Response | null {
  switch (admission.kind) {
    case "admitted":
      return null
    case "duplicate":
      return Response.json({ ok: true, duplicate: true })
    case "rate_limited":
      return jsonReject(429, "rate limited", { "Retry-After": String(admission.retryAfterSeconds) })
  }
}
