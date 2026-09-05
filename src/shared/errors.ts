
export function toError(e: unknown): Error {
  if (e instanceof Error) return e
  if (typeof e === "string") return new Error(e)
  try {
    return new Error(JSON.stringify(e))
  } catch {
    return new Error(String(e))
  }
}

export function errorMessage(e: unknown): string {
  return toError(e).message
}

export function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e
}

export function isRecord<T>(value: T): value is T & Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function onRejected(handle: (error: Error) => void): (reason: unknown) => void {
  return (reason) => {
    handle(toError(reason))
  }
}

