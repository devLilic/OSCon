import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isIP } from 'node:net'
import path from 'node:path'
import type { ConnectionSettings } from '../../../../src/shared/lab/bridgeContracts'

export interface BridgeSettings extends ConnectionSettings { token: string }
export const DEFAULT_BRIDGE_SETTINGS: ConnectionSettings = {
  schemaVersion: 1, setupConfirmed: false, enabled: false, bindAddress: '127.0.0.1', port: 47834,
  allowedOrigins: ['http://plasma.test', 'https://plasma.test'],
  receiver: { host: '127.0.0.1', port: 501, addressPrefix: '/lvb/control/' },
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configurația conexiunii trebuie să fie un obiect.')
  return value as Record<string, unknown>
}
function port(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) throw new Error('Portul trebuie să fie între 1 și 65535.')
  return value as number
}
function exactOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
  } catch { return false }
}
export function validateConnectionSettings(value: unknown): ConnectionSettings {
  const input = record(value)
  if (Object.keys(input).some(key => !['schemaVersion', 'setupConfirmed', 'enabled', 'bindAddress', 'port', 'allowedOrigins', 'receiver'].includes(key))) throw new Error('Câmp de configurare necunoscut.')
  if (input.schemaVersion !== 1) throw new Error('Versiunea setărilor OSCon nu este compatibilă.')
  if (typeof input.setupConfirmed !== 'boolean' || typeof input.enabled !== 'boolean') throw new Error('Confirmarea și activarea conexiunii trebuie să fie explicite.')
  if (typeof input.bindAddress !== 'string' || isIP(input.bindAddress) !== 4 || input.bindAddress === '0.0.0.0' || input.bindAddress === '255.255.255.255' || Number(input.bindAddress.split('.')[0]) >= 224) throw new Error('Alege adresa IPv4 exactă a interfeței locale.')
  if (!Array.isArray(input.allowedOrigins) || !input.allowedOrigins.length || input.allowedOrigins.length > 32 || !input.allowedOrigins.every(exactOrigin) || new Set(input.allowedOrigins).size !== input.allowedOrigins.length) throw new Error('Originile trebuie să fie adrese HTTP/HTTPS exacte și distincte.')
  const receiver = record(input.receiver)
  if (Object.keys(receiver).some(key => !['host', 'port', 'addressPrefix'].includes(key))) throw new Error('Câmp receiver necunoscut.')
  if (typeof receiver.host !== 'string' || receiver.host.length > 253 || !receiver.host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) || receiver.host === '0.0.0.0' || receiver.host === '255.255.255.255') throw new Error('Adresa receiverului OSC este invalidă.')
  if (typeof receiver.addressPrefix !== 'string' || receiver.addressPrefix.length > 128 || !/^\/(?:[a-z0-9_-]+\/)+$/i.test(receiver.addressPrefix)) throw new Error('Prefixul OSC trebuie să conțină segmente fixe și să se termine cu /.')
  return { schemaVersion: 1, setupConfirmed: input.setupConfirmed, enabled: input.enabled, bindAddress: input.bindAddress, port: port(input.port), allowedOrigins: [...input.allowedOrigins] as string[], receiver: { host: receiver.host, port: port(receiver.port), addressPrefix: receiver.addressPrefix } }
}
function validateStored(value: unknown): BridgeSettings {
  const { token, ...connection } = record(value)
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token)) throw new Error('Tokenul OSCon este invalid; verifică fișierul de configurare.')
  return { ...validateConnectionSettings(connection), token }
}

export class BridgeSettingsService {
  readonly filePath: string
  private readonly defaults: ConnectionSettings
  constructor(settingsRoot: string, defaults: ConnectionSettings = DEFAULT_BRIDGE_SETTINGS) {
    this.filePath = path.join(settingsRoot, 'oscon-connection.json')
    this.defaults = validateConnectionSettings(defaults)
  }
  async load({ allowCreate = true }: { allowCreate?: boolean } = {}): Promise<BridgeSettings> {
    try { return validateStored(JSON.parse(await readFile(this.filePath, 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Setările conexiunii OSCon sunt corupte sau incompatibile. Serviciul rămâne oprit.')
      if (!allowCreate) throw new Error('Defaults conexiunii sunt invalide și nu există setări locale. Salvează explicit o configurație validă.')
    }
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const defaults = { ...structuredClone(this.defaults), token: randomBytes(32).toString('hex') }
    try {
      const handle = await open(this.filePath, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(defaults, null, 2), 'utf8'); await handle.sync() }
      finally { await handle.close() }
      return defaults
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      return validateStored(JSON.parse(await readFile(this.filePath, 'utf8')))
    }
  }
  async save(settings: BridgeSettings): Promise<void> {
    const normalized = validateStored(settings)
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(normalized, null, 2), 'utf8'); await handle.sync() }
      finally { await handle.close() }
      await rename(temporary, this.filePath)
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
}
