import { mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GraphicFields, HeadlineBufferConfig } from '../../../../src/shared/lab/contracts'
import type { LabLog } from './ports'

export class PartialTextWriteError extends Error {
  readonly partial = true
  constructor(cause: unknown) {
    const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'WRITE_FAILED'
    super(`Perechea TXT a fost scrisă parțial (${code}).`)
    this.name = 'PartialTextWriteError'
  }
}

export class HeadlineTextDataSourceService {
  constructor(private readonly log: LabLog) {}

  async initialize(paths: string[], initialValues: string[] = []): Promise<void> {
    for (let index = 0; index < paths.length; index++) {
      const file = paths[index]
      await mkdir(path.dirname(file), { recursive: true })
      try {
        const handle = await open(file, 'wx')
        try { await handle.writeFile(initialValues[index] ?? '', 'utf8'); await handle.sync() }
        finally { await handle.close() }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
  }

  async writePair(config: HeadlineBufferConfig, fields: GraphicFields, operationId: string, buffer: 'A' | 'B'): Promise<void> {
    const started = performance.now()
    const paths = [config.kickerPath, config.titlePath]
    this.log.write('info', 'TXT_WRITE_BEGIN', { operationId, template: 'headline', buffer, fieldsWritten: 2 })
    await this.writeAtomic(paths[0], fields.primary)
    try {
      await this.writeAtomic(paths[1], fields.secondary)
    } catch (error) {
      this.log.write('error', 'TXT_WRITE_PARTIAL', { operationId, template: 'headline', buffer, code: getErrorCode(error) })
      throw new PartialTextWriteError(error)
    }
    this.log.write('info', 'TXT_WRITE_END', { operationId, template: 'headline', buffer, elapsedMs: Math.round(performance.now() - started) })
  }

  async writePersonPair(namePath: string, rolePath: string, fields: GraphicFields, operationId: string): Promise<void> {
    const paths = [namePath, rolePath]
    const started = performance.now()
    this.log.write('info', 'TXT_WRITE_BEGIN', { operationId, template: 'person', fieldsWritten: 2 })
    await this.writeAtomic(namePath, fields.primary)
    try { await this.writeAtomic(rolePath, fields.secondary) }
    catch (error) {
      this.log.write('error', 'TXT_WRITE_PARTIAL', { operationId, template: 'person', code: getErrorCode(error) })
      throw new PartialTextWriteError(error)
    }
    this.log.write('info', 'TXT_WRITE_END', { operationId, template: 'person', elapsedMs: Math.round(performance.now() - started) })
  }

  private async writeAtomic(file: string, value: string): Promise<void> {
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx')
      try { await handle.writeFile(value, 'utf8'); await handle.sync() }
      finally { await handle.close() }
      await rename(temporary, file)
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
  }
}

function getErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'WRITE_FAILED'
}
