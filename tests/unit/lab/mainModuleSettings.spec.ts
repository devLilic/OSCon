import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAB_SETTINGS, LAB_PRESETS } from '../../../config/lab'
import { GraphicsController } from '../../../electron/main/modules/lab/GraphicsController'
import { LabSettingsService } from '../../../electron/main/modules/lab/LabSettingsService'
import { BridgeSettingsService } from '../../../electron/main/modules/lab/BridgeSettingsService'
import { DevelopmentDefaultsService } from '../../../electron/main/modules/lab/DevelopmentDefaultsService'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(), isPackaged: false, getAppPath: vi.fn() },
  BrowserWindow: class BrowserWindow {},
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}))

const roots: string[] = []
async function root() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'oscon-main-settings-'))
  roots.push(directory)
  return directory
}
async function exists(filePath: string) {
  try { await access(filePath); return true }
  catch { return false }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

describe('OSCon startup settings policy', () => {
  it('does not materialize fallback playback settings when bundled defaults are invalid', async () => {
    const directory = await root()
    const store = new LabSettingsService(path.join(directory, 'lab-settings.json'))
    const defaultsDirectory = path.join(directory, 'defaults')
    await mkdir(defaultsDirectory)
    await writeFile(path.join(defaultsDirectory, 'playback.json'), '{broken', 'utf8')
    const defaults = new DevelopmentDefaultsService(defaultsDirectory)
    await expect(defaults.loadPlayback(DEFAULT_LAB_SETTINGS, directory)).rejects.toThrow()
    const { loadPlaybackStartupSettings } = await import('../../../electron/main/modules/lab/createLabMainModule')

    const startup = await loadPlaybackStartupSettings(store, DEFAULT_LAB_SETTINGS, 'Configurația implicită Playback este invalidă.')

    expect(startup.error).toBe('Configurația implicită Playback este invalidă.')
    expect(startup.settings).toEqual(DEFAULT_LAB_SETTINGS)
    expect(await exists(store.filePath)).toBe(false)
  })

  it('accepts a valid local playback override even when bundled defaults are invalid', async () => {
    const directory = await root()
    const store = new LabSettingsService(path.join(directory, 'lab-settings.json'))
    const override = { ...DEFAULT_LAB_SETTINGS, jsonDelayMs: 500 as const }
    await store.save(override)
    const { loadPlaybackStartupSettings } = await import('../../../electron/main/modules/lab/createLabMainModule')

    const startup = await loadPlaybackStartupSettings(store, DEFAULT_LAB_SETTINGS, 'Configurația implicită Playback este invalidă.')

    expect(startup.error).toBeNull()
    expect(startup.settings.jsonDelayMs).toBe(500)
    expect(await exists(store.filePath)).toBe(true)
  })

  it('refuses to create local connection settings when defaults are invalid, but loads a valid local override', async () => {
    const directory = await root()
    const store = new BridgeSettingsService(directory)
    const defaultsDirectory = path.join(directory, 'defaults')
    await mkdir(defaultsDirectory)
    await writeFile(path.join(defaultsDirectory, 'connection.json'), '{broken', 'utf8')
    await expect(new DevelopmentDefaultsService(defaultsDirectory).loadConnection({
      schemaVersion: 1, setupConfirmed: false, enabled: false, bindAddress: '127.0.0.1', port: 47834,
      allowedOrigins: ['http://plasma.test'], receiver: { host: '127.0.0.1', port: 501, addressPrefix: '/lvb/control/' },
    })).rejects.toThrow()

    await expect(store.load({ allowCreate: false })).rejects.toThrow('Defaults conexiunii sunt invalide')
    expect(await exists(store.filePath)).toBe(false)

    const validOverride = await store.load()
    await store.save({ ...validOverride, receiver: { ...validOverride.receiver, host: '192.168.1.30' } })
    const loaded = await store.load({ allowCreate: false })
    expect(loaded.receiver.host).toBe('192.168.1.30')
  })

  it('keeps controller reservations active until asynchronous rollback finishes', async () => {
    let releaseRollback!: () => void
    const controller = new GraphicsController(
      { writeBuffer: async () => {} },
      { send: async () => {} },
      { wait: async () => {} },
      { write: vi.fn() },
      LAB_PRESETS,
      DEFAULT_LAB_SETTINGS,
    )
    controller.reserveConnectionSettingsUpdate()
    const { rollbackBeforeRelease } = await import('../../../electron/main/modules/lab/createLabMainModule')
    const rollback = rollbackBeforeRelease(() => new Promise<void>(resolve => { releaseRollback = resolve }), () => controller.cancelConnectionSettingsUpdate())

    await Promise.resolve()
    await expect(controller.playItem('headline-1')).rejects.toThrow('Salvarea conexiunii este în curs')
    expect(() => controller.reserveSettingsUpdate(DEFAULT_LAB_SETTINGS)).toThrow('Salvarea conexiunii este în curs')

    releaseRollback()
    await rollback
    expect(() => controller.reserveSettingsUpdate(DEFAULT_LAB_SETTINGS)).not.toThrow()
    controller.cancelSettingsUpdate()
  })
})
