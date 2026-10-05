import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DevelopmentDefaultsService } from '../../../electron/main/modules/lab/DevelopmentDefaultsService'
import { DEFAULT_BRIDGE_SETTINGS } from '../../../electron/main/modules/lab/BridgeSettingsService'
import { defaultExternalTxtSettings } from '../../../config/lab'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

describe('development defaults used by installed OSCon', () => {
  it('loads versioned playback defaults and materializes output paths under app data', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oscon-defaults-'))
    directories.push(root)
    const defaults = new DevelopmentDefaultsService(path.join(root, 'defaults'))
    await mkdir(path.join(root, 'defaults'), { recursive: true })
    const output = path.join(root, 'output')
    const sourceSettings = defaultExternalTxtSettings('%OSCON_OUTPUT%')
    await writeFile(path.join(root, 'defaults', 'playback.json'), JSON.stringify({ schemaVersion: 1, settings: sourceSettings }))

    const loaded = await defaults.loadPlayback(defaultExternalTxtSettings(path.join(root, 'fallback')), output)
    expect(loaded.headline?.mode).toBe('external-txt')
    expect(loaded.headline?.buffers.A.kickerPath).toBe(path.join(output, 'PA_Supratitlu_1.txt'))
    expect(loaded.headline?.buffers.B.titlePath).toBe(path.join(output, 'PA_Title_2.txt'))
    expect(loaded.personText?.namePath).toBe(path.join(output, 'PA_Person_Name.txt'))
    await defaults.savePlayback(loaded, output)
    const saved = JSON.parse(await readFile(path.join(root, 'defaults', 'playback.json'), 'utf8'))
    expect(saved.schemaVersion).toBe(1)
    expect(saved.settings.headline.buffers.A.kickerPath).toBe('%OSCON_OUTPUT%\\PA_Supratitlu_1.txt')
    const moved = await defaults.loadPlayback(defaultExternalTxtSettings(path.join(root, 'fallback')), path.join(root, 'moved-output'))
    expect(moved.headline?.buffers.A.kickerPath).toBe(path.join(root, 'moved-output', 'PA_Supratitlu_1.txt'))
  })

  it('uses runtime fallback only when a packaged default is absent and fails closed on invalid defaults', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oscon-defaults-invalid-'))
    directories.push(root)
    const defaultsDirectory = path.join(root, 'defaults')
    const defaults = new DevelopmentDefaultsService(defaultsDirectory)
    const fallback = defaultExternalTxtSettings(path.join(root, 'fallback'))
    expect(await defaults.loadPlayback(fallback, path.join(root, 'output'))).toEqual(fallback)

    await mkdir(defaultsDirectory, { recursive: true })
    for (const contents of [
      '{broken',
      JSON.stringify({ schemaVersion: 2, settings: fallback }),
      JSON.stringify({ schemaVersion: 1, settings: { ...fallback, jsonDelayMs: 123 } }),
    ]) {
      await writeFile(path.join(defaultsDirectory, 'playback.json'), contents)
      await expect(defaults.loadPlayback(fallback, path.join(root, 'output'))).rejects.toThrow()
    }
  })

  it('keeps release connection defaults versioned, nonready, and free of tokens', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oscon-connection-defaults-'))
    directories.push(root)
    const defaults = new DevelopmentDefaultsService(root)
    await defaults.saveConnection(DEFAULT_BRIDGE_SETTINGS)
    const loaded = await defaults.loadConnection(DEFAULT_BRIDGE_SETTINGS)
    expect(loaded).toEqual(DEFAULT_BRIDGE_SETTINGS)
    expect(loaded.enabled).toBe(false)
    expect(loaded.setupConfirmed).toBe(false)
    const source = await readFile(path.join(root, 'connection.json'), 'utf8')
    expect(JSON.parse(source)).toEqual({ schemaVersion: 1, settings: DEFAULT_BRIDGE_SETTINGS })
    expect(source.toLowerCase()).not.toContain('token')
    await expect(defaults.saveConnection({ ...DEFAULT_BRIDGE_SETTINGS, token: 'a'.repeat(64) } as never)).rejects.toThrow()
  })
})
