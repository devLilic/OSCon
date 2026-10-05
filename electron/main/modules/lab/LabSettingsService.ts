import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LabSettings } from '../../../../src/shared/lab/contracts'
import { validateSettings } from '../../../../src/shared/lab/validation'

export class LabSettingsService {
  private static readonly schemaVersion = 1
  constructor(readonly filePath: string) {}

  async load(fallback: LabSettings): Promise<{ settings: LabSettings; isNew: boolean; migrated?: boolean }> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('format')
      const stored = parsed as Record<string, unknown>
      const isEnvelope = Object.prototype.hasOwnProperty.call(stored, 'schemaVersion')
      if (isEnvelope && stored.schemaVersion !== LabSettingsService.schemaVersion) throw new Error('version')
      const settingsValue = isEnvelope ? stored.settings : stored
      if (!settingsValue || typeof settingsValue !== 'object' || Array.isArray(settingsValue)) throw new Error('format')
      const settings = settingsValue as Partial<LabSettings>
      return { settings: validateSettings({
        ...settings,
        personDurationMs: settings.personDurationMs ?? fallback.personDurationMs,
        personText: settings.personText ?? fallback.personText,
      }), isNew: false, ...(!isEnvelope ? { migrated: true } : {}) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { settings: validateSettings(fallback), isNew: true }
      const reason = error instanceof Error && error.message === 'version' ? 'sau versiune incompatibilă' : 'corupt'
      throw new Error(`Nu pot citi setările LAB: format ${reason}.`)
    }
  }

  async save(settings: LabSettings): Promise<void> {
    const validated = validateSettings(settings)
    const directory = path.dirname(this.filePath)
    await mkdir(directory, { recursive: true })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx')
      try { await handle.writeFile(JSON.stringify({ schemaVersion: LabSettingsService.schemaVersion, settings: validated }, null, 2) + '\n', 'utf8'); await handle.sync() }
      finally { await handle.close() }
      await rename(temporary, this.filePath)
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
  }
}
