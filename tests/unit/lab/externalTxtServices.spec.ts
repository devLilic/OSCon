import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HeadlineTextDataSourceService } from '../../../electron/main/modules/lab/HeadlineTextDataSourceService'
import { LabSettingsService } from '../../../electron/main/modules/lab/LabSettingsService'
import { defaultExternalTxtSettings } from '../../../config/lab'
import { validateSettings } from '../../../src/shared/lab/validation'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
const log = { write() {} }

describe('external TXT settings and files', () => {
  it('writes UTF-8 text with no BOM/newline and replaces each configured buffer path', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lab-txt-'))
    directories.push(directory)
    const settings = defaultExternalTxtSettings(directory)
    const text = new HeadlineTextDataSourceService(log)
    const config = settings.headline!.buffers.A
    await text.initialize([config.kickerPath, config.titlePath])
    await text.writePair(config, { primary: 'Știri 🛰️', secondary: 'Titlu nou' }, 'test-op', 'A')
    const kicker = await readFile(config.kickerPath)
    expect(kicker.subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(kicker.toString('utf8')).toBe('Știri 🛰️')
    expect(kicker.at(-1)).not.toBe(0x0a)
    expect(await readFile(config.titlePath, 'utf8')).toBe('Titlu nou')
  })

  it('keeps TXT logs free of configured paths and field values', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lab-txt-redaction-'))
    directories.push(directory)
    const settings = defaultExternalTxtSettings(directory)
    const entries: Array<{ event: string; details?: Record<string, unknown> }> = []
    const text = new HeadlineTextDataSourceService({ write: (_level, event, details) => entries.push({ event, details }) })
    const config = settings.headline!.buffers.A
    await text.writePair(config, { primary: 'SECRET-KICKER', secondary: 'SECRET-TITLE' }, 'safe-log', 'A')
    const serialized = JSON.stringify(entries)
    expect(serialized).not.toContain(config.kickerPath)
    expect(serialized).not.toContain(config.titlePath)
    expect(serialized).not.toContain('SECRET-KICKER')
    expect(serialized).not.toContain('SECRET-TITLE')
  })

  it('writes Person name and role into the two separate configured TXT sources', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lab-person-txt-'))
    directories.push(directory)
    const settings = defaultExternalTxtSettings(directory)
    const text = new HeadlineTextDataSourceService(log)
    const { namePath, rolePath } = settings.personText!
    await text.initialize([namePath, rolePath])
    await text.writePersonPair(namePath, rolePath, { primary: 'Ana Popescu', secondary: 'Prezentatoare — test' }, 'person-op')
    expect(await readFile(namePath, 'utf8')).toBe('Ana Popescu')
    expect(await readFile(rolePath, 'utf8')).toBe('Prezentatoare — test')
    expect((await readFile(rolePath)).at(-1)).not.toBe(0x0a)
  })

  it('reports a partial replacement when the second path cannot be written', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lab-txt-partial-'))
    directories.push(directory)
    const settings = defaultExternalTxtSettings(directory)
    const config = { ...settings.headline!.buffers.A, titlePath: path.join(directory, 'missing', 'title.txt') }
    const text = new HeadlineTextDataSourceService(log)
    await expect(text.writePair(config, { primary: 'kicker', secondary: 'title' }, 'partial-op', 'A')).rejects.toMatchObject({ partial: true })
    expect(await readFile(config.kickerPath, 'utf8')).toBe('kicker')
  })

  it('creates first-run defaults and persists settings atomically while migrating legacy settings', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lab-settings-'))
    directories.push(directory)
    const file = path.join(directory, 'lab-settings.json')
    const service = new LabSettingsService(file)
    const defaults = defaultExternalTxtSettings(directory)
    expect(await service.load(defaults)).toEqual({ settings: validateSettings(defaults), isNew: true })
    await writeFile(file, JSON.stringify({ jsonDelayMs: 250, contentNames: { headline: 'OLD_HEADLINE', name: 'OLD_NAME' } }))
    const legacy = await service.load(defaults)
    expect(legacy).toMatchObject({ isNew: false, settings: { contentNames: { headline: 'OLD_HEADLINE' } } })
    expect(legacy.settings.headline).toBeUndefined()
    expect(legacy.settings.headlineTransitionGapMs).toBe(100)
    expect(legacy.settings.personText).toEqual(defaults.personText)
    await service.save(defaults)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ schemaVersion: 1, settings: validateSettings(defaults) })
  })

  it('fails closed on corrupted and unsupported playback settings', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lab-settings-invalid-'))
    directories.push(directory)
    const file = path.join(directory, 'lab-settings.json')
    const service = new LabSettingsService(file)
    for (const contents of ['{broken', JSON.stringify({ schemaVersion: 2, settings: defaultExternalTxtSettings(directory) })]) {
      await writeFile(file, contents)
      await expect(service.load(defaultExternalTxtSettings(directory))).rejects.toThrow('Nu pot citi setările LAB')
      expect(await readFile(file, 'utf8')).toBe(contents)
    }
  })

  it('validates four absolute, case-insensitively unique TXT paths and distinct exact content names', () => {
    const settings = defaultExternalTxtSettings('C:\\LAB\\output')
    expect(validateSettings(settings).headline?.mode).toBe('external-txt')
    const alias = structuredClone(settings)
    alias.headline!.buffers.B.titlePath = 'c:/lab/output/./PA_Title_1.txt'
    expect(() => validateSettings(alias)).toThrow('distincte')
    const parentAlias = structuredClone(settings)
    parentAlias.headline!.buffers.B.titlePath = 'c:/lab/output/sub/../PA_Title_1.txt'
    expect(() => validateSettings(parentAlias)).toThrow('distincte')
    const uncAlias = structuredClone(settings)
    uncAlias.headline!.buffers.A.kickerPath = '\\\\SERVER\\share\\text\\kicker.txt'
    uncAlias.headline!.buffers.B.kickerPath = '//server/share/text/./kicker.txt'
    expect(() => validateSettings(uncAlias)).toThrow('distincte')
    const uncDifferentServer = structuredClone(settings)
    uncDifferentServer.headline!.buffers.A.kickerPath = '\\\\SERVER\\share\\text\\kicker.txt'
    uncDifferentServer.headline!.buffers.B.kickerPath = '\\\\XERVER\\share\\text\\kicker.txt'
    expect(validateSettings(uncDifferentServer).headline?.buffers.B.kickerPath).toContain('XERVER')
    const relative = structuredClone(settings)
    relative.headline!.buffers.A.kickerPath = 'output/title.txt'
    expect(() => validateSettings(relative)).toThrow('absolută')
    const extension = structuredClone(settings)
    extension.headline!.buffers.A.kickerPath = 'C:\\LAB\\output\\kicker.json'
    expect(() => validateSettings(extension)).toThrow('.txt')
    const control = structuredClone(settings)
    control.headline!.buffers.A.kickerPath = 'C:\\LAB\\output\\bad\nname.txt'
    expect(() => validateSettings(control)).toThrow('validă')
    const duplicateName = structuredClone(settings)
    duplicateName.headline!.buffers.B.contentName = 'L3_NAME'
    expect(() => validateSettings(duplicateName)).toThrow('distincte')
    const casePreserving = structuredClone(settings)
    casePreserving.headline!.buffers.A.contentName = '01_X_Titlu1'
    casePreserving.headline!.buffers.B.contentName = '01_x_Titlu2'
    expect(validateSettings(casePreserving).headline?.buffers.A.contentName).toBe('01_X_Titlu1')
    const duplicatePersonPath = structuredClone(settings)
    duplicatePersonPath.personText!.rolePath = duplicatePersonPath.personText!.namePath
    expect(() => validateSettings(duplicatePersonPath)).toThrow('distincte')
  })

  it('defaults the external Headline transition gap to 100 ms and rejects unsupported values', () => {
    const settings = defaultExternalTxtSettings('C:\\LAB\\output')
    expect(settings.headlineTransitionGapMs).toBe(100)
    expect(validateSettings({ ...settings, headlineTransitionGapMs: undefined }).headlineTransitionGapMs).toBe(100)
    expect(() => validateSettings({ ...settings, headlineTransitionGapMs: 75 })).toThrow('Gap-ul de tranziție')
  })

  it('defaults Person duration to 5000 ms, persists custom durations, and validates the range', () => {
    const settings = defaultExternalTxtSettings('C:\\LAB\\output')
    expect(settings.personDurationMs).toBe(5000)
    expect(validateSettings({ ...settings, personDurationMs: undefined }).personDurationMs).toBe(5000)
    expect(validateSettings({ ...settings, personDurationMs: 7250 }).personDurationMs).toBe(7250)
    expect(() => validateSettings({ ...settings, personDurationMs: 999 })).toThrow('1000 și 60000')
    expect(() => validateSettings({ ...settings, personDurationMs: 60001 })).toThrow('1000 și 60000')
  })

  it('persists custom Person TXT paths when settings are reloaded', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lab-person-settings-'))
    directories.push(directory)
    const file = path.join(directory, 'lab-settings.json')
    const service = new LabSettingsService(file)
    const settings = defaultExternalTxtSettings(directory)
    settings.personText = { namePath: path.join(directory, 'custom-name.txt'), rolePath: path.join(directory, 'custom-role.txt') }
    await service.save(settings)
    expect((await service.load(defaultExternalTxtSettings(directory))).settings.personText).toEqual(settings.personText)
  })
})
