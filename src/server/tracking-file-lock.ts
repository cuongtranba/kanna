
const chains = new Map<string, Promise<void>>()

export async function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key)

  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const mine = (previous ?? Promise.resolve()).then(() => held)
  chains.set(key, mine)

  if (previous) await previous

  try {
    return await fn()
  } finally {
    release()
    if (chains.get(key) === mine) chains.delete(key)
  }
}

export function pendingLockCount(): number {
  return chains.size
}
