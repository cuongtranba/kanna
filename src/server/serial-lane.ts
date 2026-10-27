export interface KeyedLanes {
  run<T>(key: string, task: () => Promise<T>): Promise<T>
}

export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>
}

export function createKeyedLanes(): KeyedLanes {
  const tails = new Map<string, Promise<void>>()
  const release = (key: string, tail: Promise<void>) => {
    if (tails.get(key) === tail) tails.delete(key)
  }
  return {
    run(key, task) {
      const result = (tails.get(key) ?? Promise.resolve()).then(task)
      const tail: Promise<void> = result.then(
        () => release(key, tail),
        () => release(key, tail),
      )
      tails.set(key, tail)
      return result
    },
  }
}

export function createSerialQueue(): SerialQueue {
  const lanes = createKeyedLanes()
  return { run: (task) => lanes.run("", task) }
}

const processLanes = createKeyedLanes()

export function withKeyedLane<T>(key: string, task: () => Promise<T>): Promise<T> {
  return processLanes.run(key, task)
}
