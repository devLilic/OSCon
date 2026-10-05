import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { BridgeSettingsService, validateConnectionSettings } from '../../../electron/main/modules/lab/BridgeSettingsService'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oscon-settings-'))
  roots.push(root)
  return new BridgeSettingsService(root)
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('OSCon connection settings', () => {
  it('creates independent safe defaults, persists a random token, and never starts implicitly', async () => {
    const store = await fixture()
    const first = await store.load()
    expect(first).toMatchObject({ schemaVersion: 1, setupConfirmed: false, enabled: false, bindAddress: '127.0.0.1', port: 47834, receiver: { host: '127.0.0.1', port: 501, addressPrefix: '/lvb/control/' } })
    expect(first.token).toMatch(/^[a-f0-9]{64}$/)
    expect((await store.load()).token).toBe(first.token)
    expect((await (await fixture()).load()).token).not.toBe(first.token)
  })
  it('saves atomically and replaces settings without changing the token', async () => {
    const store = await fixture()
    const settings = await store.load()
    await store.save({ ...settings, enabled: true, setupConfirmed: true, bindAddress: '192.168.1.10', allowedOrigins: ['http://plasma.test:8080'] })
    expect(await store.load()).toMatchObject({ enabled: true, setupConfirmed: true, token: settings.token, bindAddress: '192.168.1.10' })
    const before = await readFile(store.filePath, 'utf8')
    await expect(store.save({ ...settings, port: 0 })).rejects.toThrow()
    expect(await readFile(store.filePath, 'utf8')).toBe(before)
  })
  it('fails closed on corrupted and unsupported settings without overwriting them', async () => {
    const store = await fixture()
    const settings = await store.load()
    for (const content of ['{broken', JSON.stringify({ ...settings, schemaVersion: 2 }), JSON.stringify({ ...settings, token: 'wrong' })]) {
      await writeFile(store.filePath, content)
      await expect(store.load()).rejects.toThrow()
      expect(await readFile(store.filePath, 'utf8')).toBe(content)
    }
  })
  it('validates exact origins, binding addresses, receiver and local payload fields', async () => {
    const store = await fixture()
    const { token: _secret, ...settings } = await store.load()
    expect(validateConnectionSettings(settings)).toEqual(settings)
    const bad = [
      { port: 65536 }, { bindAddress: '0.0.0.0' }, { bindAddress: 'localhost' },
      { allowedOrigins: ['*'] }, { allowedOrigins: ['http://plasma.test/'] },
      { allowedOrigins: ['http://plasma.test', 'http://plasma.test'] },
      { receiver: { ...settings.receiver, host: 'bad host' } },
      { receiver: { ...settings.receiver, host: 'bad..host' } },
      { receiver: { ...settings.receiver, addressPrefix: '/bad*' } },
      { receiver: { ...settings.receiver, addressPrefix: `/${'a'.repeat(127)}/` } },
      { token: 'injected' }, { enabled: 'true' }, { schemaVersion: 2 },
    ]
    for (const patch of bad) expect(() => validateConnectionSettings({ ...settings, ...patch })).toThrow()
  })
  it('seeds a new install from development defaults and preserves later local overrides', async () => {
    const source = await fixture()
    const { token: devToken, ...defaults } = await source.load()
    defaults.receiver = { ...defaults.receiver, host: '192.168.1.50', port: 9000 }
    defaults.allowedOrigins = ['http://plasma.test:8080']
    const install = await fixture()
    await rm(install.filePath, { force: true })
    const seeded = new BridgeSettingsService(path.dirname(install.filePath), defaults)
    const settings = await seeded.load()
    expect(settings.receiver).toEqual(defaults.receiver)
    expect(settings.allowedOrigins).toEqual(defaults.allowedOrigins)
    expect(settings.token).not.toBe(devToken)
    await seeded.save({ ...settings, port: 49000 })
    const nextRelease = new BridgeSettingsService(path.dirname(install.filePath), { ...defaults, port: 50000 })
    expect((await nextRelease.load()).port).toBe(49000)
  })
})
