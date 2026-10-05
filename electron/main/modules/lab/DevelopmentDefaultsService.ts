import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConnectionSettings } from '../../../../src/shared/lab/bridgeContracts'
import type { LabSettings } from '../../../../src/shared/lab/contracts'
import { validateSettings } from '../../../../src/shared/lab/validation'
import { validateConnectionSettings } from './BridgeSettingsService'

const schemaVersion = 1

export class DevelopmentDefaultsService {
  constructor(readonly defaultsDirectory: string) {}

  async loadPlayback(fallback: LabSettings, dataDirectory: string): Promise<LabSettings> {
    const document = await this.readDocument('playback.json')
    if (document === null) return validateSettings(fallback)
    if (document.schemaVersion !== schemaVersion || !document.settings || typeof document.settings !== 'object' || Array.isArray(document.settings)) {
      throw new Error('Configurația playback implicită OSCon este incompatibilă.')
    }
    return validateSettings(materializeOutputPaths(document.settings as LabSettings, dataDirectory))
  }

  async loadConnection(fallback: ConnectionSettings): Promise<ConnectionSettings> {
    const document = await this.readDocument('connection.json')
    if (document === null) return validateConnectionSettings(fallback)
    if (document.schemaVersion !== schemaVersion || !document.settings || typeof document.settings !== 'object' || Array.isArray(document.settings)) {
      throw new Error('Configurația conexiunii implicite OSCon este incompatibilă.')
    }
    return validateConnectionSettings(document.settings)
  }

  async savePlayback(settings: LabSettings, dataDirectory?: string): Promise<void> {
    const validated = validateSettings(settings)
    const normalized = dataDirectory ? storeOutputPaths(validated, dataDirectory) : validated
    await this.writeDocument('playback.json', { schemaVersion, settings: normalized })
  }

  async saveConnection(settings: ConnectionSettings): Promise<void> {
    // Validation rejects unknown keys, including a token, before writing the release default.
    await this.writeDocument('connection.json', { schemaVersion, settings: validateConnectionSettings(settings) })
  }

  private async readDocument(name: string): Promise<Record<string, unknown> | null> {
    let source: string
    try {
      source = await readFile(path.join(this.defaultsDirectory, name), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try {
      const parsed: unknown = JSON.parse(source)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object expected')
      return parsed as Record<string, unknown>
    } catch {
      throw new Error(`Configurația implicită ${name} este coruptă.`)
    }
  }

  private async writeDocument(name: string, value: unknown): Promise<void> {
    await mkdir(this.defaultsDirectory, { recursive: true })
    const filePath = path.join(this.defaultsDirectory, name)
    const temporary = `${filePath}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, filePath)
    } finally {
      await unlink(temporary).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
    }
  }
}

function materializeOutputPaths(settings: LabSettings, dataDirectory: string): LabSettings {
  const resolve = (value: string) => {
    const match = /^%OSCON_OUTPUT%[\\/](.+)$/.exec(value)
    return match ? path.join(dataDirectory, match[1]!.replace(/[\\/]/g, path.sep)) : value
  }
  const headline = settings.headline
  const personText = settings.personText
  return validateSettings({
    ...settings,
    ...(headline ? {
      headline: {
        ...headline,
        buffers: {
          A: { ...headline.buffers.A, kickerPath: resolve(headline.buffers.A.kickerPath), titlePath: resolve(headline.buffers.A.titlePath) },
          B: { ...headline.buffers.B, kickerPath: resolve(headline.buffers.B.kickerPath), titlePath: resolve(headline.buffers.B.titlePath) },
        },
      },
    } : {}),
    ...(personText ? { personText: { namePath: resolve(personText.namePath), rolePath: resolve(personText.rolePath) } } : {}),
  })
}

function storeOutputPaths(settings: LabSettings, dataDirectory: string): LabSettings {
  const root = path.resolve(dataDirectory).replace(/[\\/]+$/, '').toLocaleLowerCase('en-US')
  const store = (value: string) => {
    const resolved = path.resolve(value)
    const normalized = resolved.replace(/[\\/]+$/, '').toLocaleLowerCase('en-US')
    if (normalized === root) return '%OSCON_OUTPUT%'
    if (normalized.startsWith(`${root}${path.sep.toLocaleLowerCase('en-US')}`)) {
      return `%OSCON_OUTPUT%${path.sep}${path.relative(dataDirectory, resolved)}`
    }
    return value
  }
  const headline = settings.headline
  const personText = settings.personText
  return {
    ...settings,
    ...(headline ? {
      headline: {
        ...headline,
        buffers: {
          A: { ...headline.buffers.A, kickerPath: store(headline.buffers.A.kickerPath), titlePath: store(headline.buffers.A.titlePath) },
          B: { ...headline.buffers.B, kickerPath: store(headline.buffers.B.kickerPath), titlePath: store(headline.buffers.B.titlePath) },
        },
      },
    } : {}),
    ...(personText ? { personText: { namePath: store(personText.namePath), rolePath: store(personText.rolePath) } } : {}),
  }
}
