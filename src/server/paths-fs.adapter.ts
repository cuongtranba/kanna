import { realpathSync } from "node:fs"

import type { RealpathFn } from "./paths"

export const realpathAdapter: RealpathFn = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}
