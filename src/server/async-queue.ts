export class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private resolvers: Array<(value: IteratorResult<T>) => void> = []
  private done = false

  push(value: T) {
    if (this.done) return
    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver({ value, done: false })
      return
    }
    this.values.push(value)
  }

  finish() {
    if (this.done) return
    this.done = true
    const doneResult: IteratorReturnResult<undefined> = { value: undefined, done: true }
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()
      resolver?.(doneResult)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    const doneResult: IteratorReturnResult<undefined> = { value: undefined, done: true }
    return {
      next: () => {
        if (this.values.length > 0) {
          const next = this.values.shift()
          if (next !== undefined) {
            return Promise.resolve({ value: next, done: false as const })
          }
        }
        if (this.done) {
          return Promise.resolve(doneResult)
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve)
        })
      },
    }
  }
}
