import { createSocket } from 'node:dgram'
import { isIP } from 'node:net'
import { LAB_CONNECTION } from '../../../../config/lab'
import { contentName } from '../../../../src/shared/lab/validation'
import type { PlaybackCommand } from '../../../../src/shared/lab/contracts'
import type { GraphicsTransport, LabLog } from './ports'

function oscString(value: string): Buffer {
  if (value.includes('\0')) throw new Error('OSC string nu permite NUL.')
  const bytes = Buffer.from(value, 'utf8')
  const padded = Buffer.alloc(Math.ceil((bytes.length + 1) / 4) * 4)
  bytes.copy(padded)
  return padded
}
export function encodeOscMessage(address: string, args: string[]): Buffer {
  if (!/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(address)) throw new Error('Adresă OSC invalidă.')
  return Buffer.concat([oscString(address), oscString(',' + 's'.repeat(args.length)), ...args.map(oscString)])
}
export interface LiveBoardConnection { host: string; port: number; addressPrefix?: string }

export function validateLiveBoardConnection(value: unknown): Required<LiveBoardConnection> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configurația receiverului OSC este invalidă.')
  const input = value as Record<string, unknown>
  const host = typeof input.host === 'string' ? input.host.trim() : ''
  const port = input.port
  const addressPrefix = input.addressPrefix === undefined ? '/lvb/control/' : input.addressPrefix
  const validHostname = host.length <= 253 && host.length > 0 && host.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
  if (!(host.toLowerCase() === 'localhost' || isIP(host) === 4 || validHostname)) throw new Error('Hostul receiverului OSC trebuie să fie IPv4, localhost sau hostname valid.')
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) throw new Error('Portul receiverului OSC trebuie să fie între 1 și 65535.')
  if (typeof addressPrefix !== 'string' || !/^\/(?:[A-Za-z0-9_.-]+\/)+$/.test(addressPrefix) || addressPrefix.length > 128) throw new Error('Prefixul OSC trebuie să fie o cale OSC sigură terminată cu / .')
  return { host, port: port as number, addressPrefix }
}

export class LiveBoardOscService implements GraphicsTransport {
  private readonly socket = createSocket('udp4')
  private closed = false
  private connection: Required<LiveBoardConnection>
  constructor(private readonly log: LabLog, connection: LiveBoardConnection = LAB_CONNECTION) {
    this.connection = validateLiveBoardConnection(connection)
    this.socket.on('error', error => this.log.write('error', 'OSC_SOCKET_ERROR', { code: getErrorCode(error) }))
  }

  updateConnection(next: LiveBoardConnection): Required<LiveBoardConnection> {
    const validated = validateLiveBoardConnection(next)
    this.connection = validated
    return { ...validated }
  }

  async send(command: PlaybackCommand, target: string, operationId: string): Promise<void> {
    if (this.closed) throw new Error('Socket OSC închis.')
    const content = contentName(target)
    const suffix = ({ play: 'play', stop: 'stop', pause: 'pause', resume: 'resume' } as const)[command]
    if (!suffix) throw new Error('Comandă OSC nepermisă.')
    const connection = { ...this.connection }
    const address = `${connection.addressPrefix}${suffix}`
    const packet = encodeOscMessage(address, [content])
    const host = connection.host.toLowerCase() === 'localhost' ? '127.0.0.1' : connection.host
    const started = performance.now()
    const destination = { host, port: connection.port }
    const eventDetails = { operationId, direction: 'out', address, target: destination }
    this.log.write('info', 'OSC_SEND_BEGIN', { ...eventDetails, typeTags: ',s', bytes: packet.length })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Timeout local la trimiterea UDP. Rezultat neconfirmat.')), 2000)
      const onError = (error: Error) => finish(error)
      const finish = (error?: Error | null) => {
        clearTimeout(timer)
        this.socket.off('error', onError)
        if (error) reject(error); else resolve()
      }
      this.socket.once('error', onError)
      try { this.socket.send(packet, connection.port, host, finish) }
      catch (error) { finish(error as Error) }
    })
    this.log.write('info', 'OSC_SEND_END', { ...eventDetails, timestampIso: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), confirmation: 'UDP_LOCAL_SEND_ONLY' })
  }
  close() { if (!this.closed) { this.closed = true; try { this.socket.close() } catch { /* Socket can be unbound before first send. */ } } }
}

function getErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'SOCKET_ERROR'
}
