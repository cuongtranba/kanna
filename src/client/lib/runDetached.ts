import { LOG_PREFIX } from "../../shared/branding"
import { onRejected } from "../../shared/errors"
import { log } from "../../shared/log"

export function runDetached<T>(label: string, task: Promise<T>): void {
  task.then(undefined, onRejected((error) => log.error(LOG_PREFIX, `${label} failed`, error)))
}
