import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import type { Logger } from '../../logging'
import type { LabLogEntry } from '../../../../src/shared/lab/contracts'
import type { LabLog } from './ports'

export class EventLog implements LabLog {
  private entries: LabLogEntry[] = []
  private sequence = 0
  readonly filePath: string
  persistenceError: string | null = null
  onChange: () => void = () => {}
  constructor(directory: string, private readonly logger: Logger) {
    mkdirSync(directory, { recursive: true })
    this.filePath = path.join(directory, 'lab-events.jsonl')
  }
  write(level: LabLogEntry['level'], event: string, details: Record<string, unknown> = {}) {
    const entry: LabLogEntry = { id: ++this.sequence, time: new Date().toISOString(), level, event, details }
    this.entries.push(entry)
    if (this.entries.length > 200) this.entries.shift()
    this.logger[level](event, details)
    try {
      if (existsSync(this.filePath) && statSync(this.filePath).size > 5 * 1024 * 1024) {
        renameSync(this.filePath, this.filePath + '.1')
      }
      appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8')
      this.persistenceError = null
    } catch (error) {
      this.persistenceError = getErrorCode(error)
      this.logger.error('LOG_PERSISTENCE_ERROR', { code: this.persistenceError })
    }
    this.onChange()
  }
  getEntries() { return structuredClone(this.entries) }
}

function getErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'LOG_WRITE_FAILED'
}
