import { request as httpRequest, createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControllerHttpBridge } from '../../../electron/main/modules/lab/ControllerHttpBridge'
import { DEFAULT_BRIDGE_SETTINGS } from '../../../electron/main/modules/lab/BridgeSettingsService'
import type { GraphicsController } from '../../../electron/main/modules/lab/GraphicsController'

const instances: ControllerHttpBridge[] = []
const ORIGIN = 'http://plasma.test'
const TOKEN = 'a'.repeat(64)
function fixtureController() {
  const template = () => ({ state: 'OFF', busy: false, activeItemId: null, activeBuffer: null, hiddenBuffer: null, bufferItems: { A: null, B: null }, bufferFields: { A: { primary: 'secret MOS value', secondary: 'private' }, B: null }, personExpiresAt: null, lastError: null, confirmation: 'LOCAL/UNCONFIRMED' })
  const state = { headline: template(), name: template() }
  const controller = {
    getTemplates: () => structuredClone(state),
    getPresets: () => ['headline-1', 'name-1'].map(id => ({ id, label: id, templateType: id.startsWith('headline') ? 'headline' : 'name', fields: { primary: 'preset', secondary: '' } })),
    playItem: vi.fn(async () => {}), stopTemplate: vi.fn(async () => {}),
  }
  return { controller, state }
}
async function fixture(enabled = true) {
  const { controller, state } = fixtureController()
  const bridge = new ControllerHttpBridge({ controller: controller as unknown as GraphicsController, settings: { ...structuredClone(DEFAULT_BRIDGE_SETTINGS), enabled, setupConfirmed: enabled, token: TOKEN }, portOverride: 0 })
  instances.push(bridge)
  await bridge.start()
  return { bridge, controller, state }
}
async function call(bridge: ControllerHttpBridge, route: string, options: RequestInit = {}) {
  return fetch(bridge.getInfo().endpoint + route, { ...options, headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } })
}
afterEach(async () => { await Promise.all(instances.splice(0).map(bridge => bridge.close())) })

describe('OSCon HTTP connector', () => {
  it('keeps the default listener disabled until setup is confirmed', async () => {
    const { bridge } = await fixture(false)
    expect(bridge.getInfo().status).toBe('offline')
    expect(bridge.getInfo()).not.toHaveProperty('token')
    expect(bridge.getInfo()).not.toHaveProperty('configPath')
  })
  it('reports identity, local state and preset contracts without private text or secrets', async () => {
    const { bridge } = await fixture()
    const response = await call(bridge, '/v1/health')
    expect(await response.json()).toMatchObject({ service: 'oscon', protocolVersion: 1, ready: true, confirmation: 'LOCAL/UNCONFIRMED' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    const state = await (await call(bridge, '/v1/state')).text()
    expect(state).not.toContain('secret MOS value')
    expect(state).not.toContain(TOKEN)
    const profiles = await (await call(bridge, '/v1/profiles')).json()
    expect(profiles.profiles).toHaveLength(2)
    expect(profiles.profiles[0]).toMatchObject({ template: 'headline', fields: ['primary', 'secondary'] })
  })
  it('accepts explicit title and Person commands with blanks and diacritics', async () => {
    const { bridge, controller } = await fixture()
    const post = (body: unknown) => call(bridge, '/v1/play', { method: 'POST', body: JSON.stringify(body) })
    expect(await (await post({ itemId: 'headline-1', fields: { primary: 'Știri', secondary: '' } })).json()).toMatchObject({ ok: true, outcome: 'completed locally' })
    expect(controller.playItem).toHaveBeenCalledWith('headline-1', { primary: 'Știri', secondary: '' })
    expect((await post({ itemId: 'name-1' })).status).toBe(200)
    expect((await call(bridge, '/v1/stop', { method: 'POST', body: JSON.stringify({ template: 'name' }) })).status).toBe(200)
    expect(controller.stopTemplate).toHaveBeenCalledWith('name')
  })
  it('requires exact Host, Origin and token and rejects unsafe preflight headers', async () => {
    const { bridge } = await fixture()
    const unauthorized = await call(bridge, '/v1/state', { headers: { Authorization: 'Bearer wrong' } })
    expect(unauthorized.status).toBe(401)
    expect(await unauthorized.json()).not.toHaveProperty('state')
    const wrongOrigin = await call(bridge, '/v1/state', { headers: { Origin: 'http://evil.test' } })
    expect(wrongOrigin.status).toBe(403)
    expect(wrongOrigin.headers.get('access-control-allow-origin')).toBeNull()
    const preflight = await call(bridge, '/v1/play', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('cache-control')).toBe('no-store')
    expect((await call(bridge, '/v1/play', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-anything' } })).status).toBe(403)
    const url = new URL(bridge.getInfo().endpoint)
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({ hostname: url.hostname, port: url.port, path: '/v1/state', headers: { Host: 'evil.test', Origin: ORIGIN, Authorization: `Bearer ${TOKEN}` } }, response => { response.resume(); resolve(response.statusCode!) })
      request.on('error', reject); request.end()
    })
    expect(status).toBe(403)
  })
  it('rejects malformed, oversized, unknown and routing payloads before invoking controller', async () => {
    const { bridge, controller } = await fixture()
    const bodies = ['{', JSON.stringify({ itemId: 'missing' }), JSON.stringify({ itemId: 'headline-1', path: 'C:/private.txt' }), JSON.stringify({ itemId: 'headline-1', fields: { primary: 2 } }), JSON.stringify({ itemId: 'headline-1', fields: null }), JSON.stringify({ itemId: 'headline-1', fields: { command: 'stopall' } }), JSON.stringify({ itemId: 'headline-1', extra: 'x'.repeat(17000) })]
    for (const body of bodies) expect((await call(bridge, '/v1/play', { method: 'POST', body })).status).toBe(400)
    expect((await call(bridge, '/v1/play', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status).toBe(400)
    expect((await call(bridge, '/v1/play?unsafe=1')).status).toBe(404)
    expect((await call(bridge, '/v1/unknown')).status).toBe(404)
    expect(controller.playItem).not.toHaveBeenCalled()
  })
  it('requires manual recovery at startup and reports concurrent work without replay', async () => {
    const { bridge, state, controller } = await fixture()
    const play = () => call(bridge, '/v1/play', { method: 'POST', body: JSON.stringify({ itemId: 'headline-1' }) })
    state.headline.state = 'UNKNOWN'
    expect((await play()).status).toBe(409)
    state.headline.state = 'NEEDS_RESYNC'
    expect((await play()).status).toBe(409)
    state.headline.state = 'OFF'; state.name.busy = true
    expect((await play()).status).toBe(409)
    expect(controller.playItem).not.toHaveBeenCalled()
  })
  it('redacts controller failures and configured paths from HTTP', async () => {
    const { bridge, controller, state } = await fixture()
    controller.playItem.mockImplementation(async () => { state.headline.lastError = 'C:/private/MOS.txt' as never; throw new Error('C:/private/MOS.txt') })
    const response = await call(bridge, '/v1/play', { method: 'POST', body: JSON.stringify({ itemId: 'headline-1' }) })
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('C:/private')
  })
  it('reports bind failure and closes its live listener', async () => {
    const occupied = createServer()
    await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve))
    try {
      const { controller } = fixtureController()
      const bridge = new ControllerHttpBridge({ controller: controller as unknown as GraphicsController, settings: { ...structuredClone(DEFAULT_BRIDGE_SETTINGS), enabled: true, setupConfirmed: true, token: TOKEN }, portOverride: (occupied.address() as { port: number }).port })
      instances.push(bridge); await bridge.start()
      expect(bridge.getInfo().status).toBe('error')
    } finally { await new Promise<void>(resolve => occupied.close(() => resolve())) }
    const { bridge } = await fixture()
    const url = bridge.getInfo().endpoint
    await bridge.close()
    await expect(fetch(url + '/v1/health')).rejects.toThrow()
  })
})
