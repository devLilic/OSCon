import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { BridgeInfo } from '../../../../src/shared/lab/bridgeContracts'
import type { GraphicFields, TemplateSnapshot } from '../../../../src/shared/lab/contracts'
import { mergeGraphicFields } from '../../../../src/shared/lab/validation'
import type { GraphicsController } from './GraphicsController'
import type { BridgeSettings } from './BridgeSettingsService'

export interface ControllerBridgeOptions {
  controller: GraphicsController
  settings: BridgeSettings
  configPath?: string
  portOverride?: number
}

const MAX_BODY_BYTES = 16 * 1024
const BODY_TIMEOUT_MS = 10_000
const ALLOWED_HEADERS = 'Authorization, Content-Type'

export class ControllerHttpBridge {
  private server: Server | null = null
  private status: BridgeInfo['status'] = 'offline'
  private error: string | null = null
  private boundPort: number
  private readonly port: number

  constructor(private readonly options: ControllerBridgeOptions) {
    this.port = options.portOverride ?? options.settings.port
    this.boundPort = this.port
  }

  async start(): Promise<void> {
    if (this.server) return
    if (!this.options.settings.enabled || !this.options.settings.setupConfirmed) return
    const server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.destroyed && !response.writableEnded) {
          const authorizedContext = request.headers.host === `${this.options.settings.bindAddress}:${this.boundPort}` && typeof request.headers.origin === 'string' && this.options.settings.allowedOrigins.includes(request.headers.origin) && this.authorized(request.headers.authorization)
          try { this.reply(response, 500, authorizedContext ? { ok: false, error: 'Internal server error.', state: this.state() } : { ok: false, error: 'Internal server error.' }) }
          catch { response.destroy() }
        }
      })
    })
    server.headersTimeout = 10_000
    server.requestTimeout = 10_000
    server.keepAliveTimeout = 1000
    this.server = server
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { server.off('listening', onListening); reject(error) }
        const onListening = () => { server.off('error', onError); resolve() }
        server.once('error', onError)
        server.once('listening', onListening)
      server.listen(this.port, this.options.settings.bindAddress)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Bridge did not bind a TCP address.')
      this.boundPort = address.port
      this.status = 'online'
      this.error = null
    } catch (error) {
      this.status = 'error'
      this.error = 'Listenerul HTTP nu poate porni pe adresa și portul configurate.'
      this.server = null
      server.close()
    }
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server || !server.listening) { this.status = 'offline'; return }
    const closed = new Promise<void>(resolve => server.close(() => resolve()))
    server.closeAllConnections()
    await closed
    this.status = 'offline'
  }

  getInfo(): BridgeInfo {
    return {
      endpoint: `http://${this.options.settings.bindAddress}:${this.boundPort}`,
      allowedOrigins: [...this.options.settings.allowedOrigins],
      status: this.status,
      error: this.error,
      receiver: { ...this.options.settings.receiver },
      setupConfirmed: this.options.settings.setupConfirmed,
    }
  }

  private state() {
    const sanitize = ({ bufferFields: _fields, ...template }: TemplateSnapshot) => ({ ...template, lastError: template.lastError ? 'Operația a eșuat; verifică diagnosticul local.' : null })
    const templates = this.options.controller.getTemplates()
    return { headline: sanitize(templates.headline), name: sanitize(templates.name) }
  }

  private reply(response: ServerResponse, status: number, payload: unknown, corsOrigin?: string) {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    if (corsOrigin) {
      response.setHeader('Access-Control-Allow-Origin', corsOrigin)
      response.setHeader('Vary', 'Origin')
    }
    response.end(JSON.stringify({ protocolVersion: 1, ...(payload as Record<string, unknown>) }))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const state = () => this.state()
    const fail = (status: number, error: string, corsOrigin?: string, includeState = true) => this.reply(response, status, includeState ? { ok: false, error, state: state() } : { ok: false, error }, corsOrigin)
    const host = request.headers.host
    if (host !== `${this.options.settings.bindAddress}:${this.boundPort}`) { fail(403, 'Host header rejected.', undefined, false); return }
    const origin = request.headers.origin
    if (typeof origin !== 'string' || !this.options.settings.allowedOrigins.includes(origin)) { fail(403, 'Origin rejected.', undefined, false); return }

    const url = new URL(request.url ?? '/', `http://${this.options.settings.bindAddress}:${this.boundPort}`)
    if (url.origin !== `http://${this.options.settings.bindAddress}:${this.boundPort}` || url.search || !['/v1/health', '/v1/state', '/v1/profiles', '/v1/play', '/v1/stop'].includes(url.pathname)) { fail(404, 'Route not found.', origin, false); return }
    if (request.method === 'OPTIONS') {
      const method = request.headers['access-control-request-method']
      const headers = String(request.headers['access-control-request-headers'] ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
      if ((method !== 'GET' && method !== 'POST') || headers.some(header => header !== 'authorization' && header !== 'content-type')) { fail(403, 'Preflight rejected.', undefined, false); return }
      response.statusCode = 204
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      response.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS)
      response.setHeader('Access-Control-Max-Age', '300')
      response.setHeader('Vary', 'Origin')
      response.setHeader('Cache-Control', 'no-store')
      response.end()
      return
    }

    if (!this.authorized(request.headers.authorization)) { fail(401, 'Unauthorized.', origin, false); return }
    if (request.method === 'GET' && url.pathname === '/v1/health' && !url.search) {
      this.reply(response, 200, { ok: true, service: 'oscon', protocolVersion: 1, ready: this.status === 'online', confirmation: 'LOCAL/UNCONFIRMED', state: state() }, origin)
      return
    }
    if (request.method === 'GET' && url.pathname === '/v1/state' && !url.search) {
      this.reply(response, 200, { ok: true, state: state() }, origin)
      return
    }
    if (request.method === 'GET' && url.pathname === '/v1/profiles') {
      this.reply(response, 200, { ok: true, protocolVersion: 1, profiles: ['headline', 'name'].map(template => ({ template, fields: ['primary', 'secondary'], items: this.options.controller.getPresets().filter(item => item.templateType === template).map(item => ({ id: item.id, label: item.label })) })) }, origin)
      return
    }
    if (request.method !== 'POST' || (url.pathname !== '/v1/play' && url.pathname !== '/v1/stop') || url.search) { fail(404, 'Route not found.', origin); return }
    if (!this.isJson(request.headers['content-type'])) { fail(400, 'Content-Type must be application/json.', origin); return }
    let body: unknown
    try { body = await this.readJson(request) }
    catch (error) { fail(400, error instanceof Error ? error.message : 'Invalid JSON.', origin); return }

    const templates = state()
    if (templates.headline.busy || templates.name.busy) { fail(409, 'Controller is busy.', origin); return }
    if (url.pathname === '/v1/play') {
      if (!body || typeof body !== 'object' || Array.isArray(body)) { fail(400, 'Expected {itemId:string, fields?:{primary?:string,secondary?:string}}.', origin); return }
      const payload = body as Record<string, unknown>
      if (Object.keys(payload).some(key => key !== 'itemId' && key !== 'fields') || typeof payload.itemId !== 'string') { fail(400, 'PLAY payload contains invalid fields.', origin); return }
      const itemId = payload.itemId
      const preset = this.options.controller.getPresets().find(item => item.id === itemId)
      if (!/^(?:headline|name)-[1-9]\d{0,2}$/.test(itemId) || !preset) { fail(400, 'Unknown preset.', origin); return }
      const hasFields = Object.prototype.hasOwnProperty.call(payload, 'fields')
      const fields = payload.fields
      try { mergeGraphicFields(hasFields ? fields : undefined, preset.fields) }
      catch (error) { fail(400, error instanceof Error ? error.message : 'Invalid text fields.', origin); return }
      if (templates[preset.templateType].state === 'NEEDS_RESYNC' || templates[preset.templateType].state === 'UNKNOWN') { fail(409, 'Template needs manual STOP or resync.', origin); return }
      try { await this.options.controller.playItem(itemId, fields as Partial<GraphicFields> | undefined) }
      catch (error) { fail(this.isControllerConflict(error) ? 409 : 500, 'Comanda nu a fost finalizată. Verifică starea locală.', origin); return }
      this.reply(response, 200, { ok: true, outcome: 'completed locally', state: state() }, origin)
      return
    }

    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !['headline', 'name'].includes((body as Record<string, unknown>).template as string)) { fail(400, 'Expected {template:"headline"|"name"}.', origin); return }
    try { await this.options.controller.stopTemplate((body as { template: 'headline' | 'name' }).template) }
    catch (error) { fail(this.isControllerConflict(error) ? 409 : 500, 'Comanda nu a fost finalizată. Verifică starea locală.', origin); return }
    this.reply(response, 200, { ok: true, outcome: 'completed locally', state: state() }, origin)
  }

  private isControllerConflict(error: unknown): boolean {
    const templates = this.options.controller.getTemplates()
    const message = error instanceof Error ? error.message : String(error)
    return templates.headline.busy || templates.headline.state === 'NEEDS_RESYNC' || templates.name.personExpiresAt !== null || message.includes('Template ocupat') || message.includes('Salvarea setărilor este în curs.')
  }

  private authorized(value: string | undefined): boolean {
    if (!value || !value.startsWith('Bearer ')) return false
    const received = value.slice(7)
    const digest = (token: string) => createHash('sha256').update(token).digest()
    return timingSafeEqual(digest(received), digest(this.options.settings.token))
  }

  private isJson(value: string | undefined): boolean {
    return Boolean(value && /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(value))
  }

  private discardAndClose(request: IncomingMessage) {
    request.resume()
    const closeTimer = setTimeout(() => request.destroy(), 1000)
    closeTimer.unref()
  }

  private readJson(request: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      let settled = false
      const finish = (error?: Error, result?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        request.off('data', onData)
        request.off('end', onEnd)
        request.off('aborted', onAborted)
        request.off('error', onError)
        if (error) reject(error)
        else resolve(result)
      }
      const onData = (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > MAX_BODY_BYTES) {
          finish(new Error('Request body too large.'))
          this.discardAndClose(request)
          return
        }
        chunks.push(buffer)
      }
      const onEnd = () => {
        try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { finish(new Error('Invalid JSON.')) }
      }
      const onAborted = () => finish(new Error('Request body aborted.'))
      const onError = () => finish(new Error('Request body failed.'))
      const timer = setTimeout(() => {
        finish(new Error('Request body timed out.'))
        this.discardAndClose(request)
      }, BODY_TIMEOUT_MS)
      timer.unref()
      request.on('data', onData)
      request.once('end', onEnd)
      request.once('aborted', onAborted)
      request.once('error', onError)
    })
  }
}
