export const OUTPUT_RING_DEFAULT_BYTES = 256 * 1024

export class OutputRing {
  private buf = ""
  private readonly capacity: number

  constructor(capacityBytes: number = OUTPUT_RING_DEFAULT_BYTES) {
    this.capacity = capacityBytes
  }

  append(chunk: string): void {
    this.buf += chunk
    if (this.buf.length > this.capacity) {
      this.buf = this.buf.slice(this.buf.length - this.capacity)
    }
  }

  tail(): string {
    return this.buf
  }

  contains(needle: string): boolean {
    return this.buf.includes(needle)
  }
}
