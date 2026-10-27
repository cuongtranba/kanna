import { homedir } from "node:os"

export function currentHomeDir(): string {
  return process.env.HOME ?? homedir()
}
