import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BufferId, GraphicItem, TemplateType } from '../../../../src/shared/lab/contracts'
import { INITIAL_JSON } from '../../../../config/lab'
import type { JsonDataSource, LabLog } from './ports'

export class JsonDataSourceService implements JsonDataSource {
  readonly paths: Record<TemplateType, string>
  constructor(private readonly directory: string, private readonly log: LabLog) {
    this.paths = { headline: path.join(directory, 'headline.json'), name: path.join(directory, 'name.json') }
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true })
    for (const type of ['headline', 'name'] as const) {
      try {
        const handle = await open(this.paths[type], 'wx')
        try { await handle.writeFile(JSON.stringify(INITIAL_JSON[type], null, 2) + '\n', 'utf8'); await handle.sync() }
        finally { await handle.close() }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
  }
  async writeBuffer(item: GraphicItem, buffer: BufferId, operationId: string): Promise<void> {
    const started = performance.now()
    const file = this.paths[item.templateType]
    const keys = item.templateType === 'headline' ? [`KICKER_${buffer}`, `TITLE_${buffer}`] : [`NAME_${buffer}`, `ROLE_${buffer}`]
    this.log.write('info', 'JSON_WRITE_BEGIN', { operationId, template: item.templateType, buffer, keyCount: keys.length })
    if ((await stat(file)).size > 1024 * 1024) throw new Error('Fișierul JSON depășește limita LAB de 1 MB.')
    const data: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('DataSource trebuie să fie un obiect JSON.')
    const record = data as Record<string, unknown>
    for (const key of Object.keys(INITIAL_JSON[item.templateType])) {
      if (typeof record[key] !== 'string') throw new Error(`Câmp JSON lipsă sau invalid: ${key}`)
    }
    record[keys[0]] = item.fields.primary
    record[keys[1]] = item.fields.secondary
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx')
      try { await handle.writeFile(JSON.stringify(record, null, 2) + '\n', 'utf8'); await handle.sync() }
      finally { await handle.close() }
      await rename(temporary, file)
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    this.log.write('info', 'JSON_WRITE_END', { operationId, template: item.templateType, buffer, elapsedMs: Math.round(performance.now() - started) })
  }
}
