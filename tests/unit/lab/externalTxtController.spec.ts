import { describe, expect, it, vi } from 'vitest'
import { GraphicsController } from '../../../electron/main/modules/lab/GraphicsController'
import { LAB_PRESETS, DEFAULT_LAB_SETTINGS, defaultExternalTxtSettings } from '../../../config/lab'

function setup(settings = defaultExternalTxtSettings('C:\\lab-output')) {
  const order: string[] = []
  const writeBuffer = vi.fn(async () => { order.push('json') })
  const writePair = vi.fn(async (_config, _fields, _operationId, buffer) => { order.push(`txt-${buffer}`) })
  const writePersonPair = vi.fn(async (_namePath, _rolePath, _fields, _operationId) => { order.push('person-txt') })
  const send = vi.fn(async (command, content) => { order.push(`${command}-${content}`) })
  const wait = vi.fn(async (ms: number) => { order.push(`delay-${ms}`) })
  const log = { write: vi.fn() }
  const controller = new GraphicsController({ writeBuffer }, { send }, { wait }, log, LAB_PRESETS, settings, () => {}, { writePair }, { writePersonPair })
  controller.resync('headline', 'OFF')
  controller.resync('name', 'OFF')
  return { controller, writeBuffer, writePair, writePersonPair, send, wait, order, log }
}

describe('Headline external TXT mode', () => {
  it('tracks most recently played active template and falls back after STOP', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    expect(s.controller.getActivationOrder()).toEqual(['headline'])
    await s.controller.playItem('name-1')
    expect(s.controller.getActivationOrder()).toEqual(['headline', 'name'])
    await s.controller.stopTemplate('name')
    expect(s.controller.getActivationOrder()).toEqual(['headline'])
    await s.controller.stopTemplate('headline')
    expect(s.controller.getActivationOrder()).toEqual([])
  })

  it('resumes the active headline before Person and restores it when the configured Person timer expires', async () => {
    vi.useFakeTimers()
    try {
      const s = setup()
      await s.controller.playItem('headline-1')
      await s.controller.playItem('name-1')
      expect(s.order.slice(3)).toEqual([
        'person-txt', 'delay-250', 'resume-01_X_Titlu1', 'delay-100', 'play-L3_NAME',
      ])
      expect(s.writePersonPair).toHaveBeenCalledWith('C:\\lab-output\\PA_Person_Name.txt', 'C:\\lab-output\\PA_Person_Role.txt', LAB_PRESETS.find(item => item.id === 'name-1')!.fields, expect.any(String))
      expect(s.controller.getTemplates().headline).toMatchObject({ state: 'SUSPENDED_FOR_PERSON', activeBuffer: 'A' })
      expect(s.controller.getTemplates().name.personExpiresAt).toBe(Date.now() + 5000)
      await expect(s.controller.playItem('headline-2')).rejects.toThrow('blocat până la expirarea Person')
      await vi.advanceTimersByTimeAsync(5000)
      expect(s.order.at(-1)).toBe('play-01_X_Titlu1')
      expect(s.controller.getTemplates().headline).toMatchObject({ state: 'ON_A', activeBuffer: 'A' })
      expect(s.controller.getTemplates().name).toMatchObject({ state: 'OFF', personExpiresAt: null })
      expect(s.controller.getActivationOrder()).toEqual(['headline'])
    } finally { vi.useRealTimers() }
  })

  it('returns to the previous headline immediately when Person is manually stopped', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    await s.controller.playItem('name-2')
    await s.controller.stopTemplate('name')
    expect(s.order.slice(-2)).toEqual(['stop-L3_NAME', 'play-01_X_Titlu1'])
    expect(s.controller.getTemplates()).toMatchObject({
      headline: { state: 'ON_A', activeBuffer: 'A' },
      name: { state: 'OFF', personExpiresAt: null },
    })
  })

  it('writes A then swaps by RESUME-old, configured gap, and PLAY-new', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    expect(s.order).toEqual(['txt-A', 'delay-250', 'play-01_X_Titlu1'])
    expect(s.writePair).toHaveBeenLastCalledWith(s.controller.getSettings().headline?.buffers.A, LAB_PRESETS[0].fields, expect.any(String), 'A')
    await s.controller.playItem('headline-2')
    expect(s.order.slice(3)).toEqual(['txt-B', 'delay-250', 'resume-01_X_Titlu1', 'delay-100', 'play-01_x_Titlu2'])
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'ON_B', activeBuffer: 'B', hiddenBuffer: 'A' })
    expect(s.log.write).toHaveBeenCalledWith('info', 'PLAY_INTENT', expect.objectContaining({ sequence: ['resume_previous', 'transition_gap', 'play_new'], transitionGapMs: 100 }))
    await s.controller.playItem('headline-3')
    expect(s.order.slice(8)).toEqual(['txt-A', 'delay-250', 'resume-01_x_Titlu2', 'delay-100', 'play-01_X_Titlu1'])
    expect(s.wait.mock.calls.map(([ms]) => ms)).toEqual([250, 250, 100, 250, 100])
    expect(s.controller.getTemplates().headline.state).toBe('ON_A')
    expect(s.writeBuffer).not.toHaveBeenCalled()
  })

  it('keeps same-text PLAY as a no-op and preserves companion text on edits', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    await s.controller.playItem('headline-1')
    expect(s.send).toHaveBeenCalledTimes(1)
    await s.controller.playItem('headline-1', { secondary: 'Titlu nou' })
    expect(s.writePair).toHaveBeenLastCalledWith(s.controller.getSettings().headline?.buffers.B,
      { primary: LAB_PRESETS[0].fields.primary, secondary: 'Titlu nou' }, expect.any(String), 'B')
    expect(s.send).toHaveBeenNthCalledWith(2, 'resume', '01_X_Titlu1', expect.any(String))
    expect(s.send).toHaveBeenNthCalledWith(3, 'play', '01_x_Titlu2', expect.any(String))
  })

  it('partial text-pair failure sends no OSC, clears the target metadata, and preserves the stable state', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    s.writePair.mockRejectedValueOnce(Object.assign(new Error('title replace failed'), { partial: true }))
    await expect(s.controller.playItem('headline-2')).rejects.toThrow('title replace failed')
    expect(s.send).toHaveBeenCalledTimes(1)
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'ON_A', activeBuffer: 'A', bufferItems: { A: 'headline-1', B: null } })
  })

  it('ambiguous OSC send failure enters NEEDS_RESYNC and blocks another PLAY until STOP succeeds', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    s.send.mockRejectedValueOnce(new Error('socket error'))
    await expect(s.controller.playItem('headline-2')).rejects.toThrow('RESUME pentru contentul anterior a eșuat: socket error')
    expect(s.controller.getTemplates().headline.state).toBe('NEEDS_RESYNC')
    expect(s.log.write).toHaveBeenCalledWith('warn', 'OSC_SEND_UNCERTAIN', expect.objectContaining({ stage: 'RESUME pentru contentul anterior', recovery: 'STOP or manual resync before another PLAY' }))
    await expect(s.controller.playItem('headline-1')).rejects.toThrow('resync')
    await s.controller.stopTemplate('headline')
    expect(s.send).toHaveBeenLastCalledWith('stop', '01_x_Titlu2', expect.any(String))
    expect(s.controller.getTemplates().headline.state).toBe('OFF')
  })

  it('attempts both content STOPs even when the first fails; successful recovery resets OFF', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    s.send.mockRejectedValueOnce(new Error('first stop failed'))
    await expect(s.controller.stopTemplate('headline')).rejects.toThrow('first stop failed')
    expect(s.send.mock.calls.slice(1).map(call => call[1])).toEqual(['01_X_Titlu1', '01_x_Titlu2'])
    expect(s.controller.getTemplates().headline.state).toBe('NEEDS_RESYNC')
    await s.controller.stopTemplate('headline')
    expect(s.controller.getTemplates().headline.state).toBe('OFF')
  })

  it('marks state uncertain if the old-content RESUME succeeds locally but the new PLAY fails', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    s.send.mockResolvedValueOnce(undefined)
    s.send.mockRejectedValueOnce(new Error('socket error'))
    await expect(s.controller.playItem('headline-2')).rejects.toThrow('PLAY pentru contentul nou a eșuat: socket error')
    expect(s.send.mock.calls.slice(1).map(call => call.slice(0, 2))).toEqual([
      ['resume', '01_X_Titlu1'], ['play', '01_x_Titlu2'],
    ])
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'NEEDS_RESYNC', activeBuffer: 'A' })
  })

  it('uses a separately configured transition gap after the existing propagation delay', async () => {
    const settings = defaultExternalTxtSettings('C:\\lab-output')
    settings.headlineTransitionGapMs = 250
    const s = setup(settings)
    await s.controller.playItem('headline-1')
    await s.controller.playItem('headline-2')
    expect(s.order.slice(3)).toEqual(['txt-B', 'delay-250', 'resume-01_X_Titlu1', 'delay-250', 'play-01_x_Titlu2'])
    expect(s.controller.getSettings().headlineTransitionGapMs).toBe(250)
  })

  it('reserves configuration during persistence and clears buffer metadata after an OFF config change', async () => {
    const s = setup()
    const next = { ...s.controller.getSettings(), jsonDelayMs: 500 as const }
    const reserved = s.controller.reserveSettingsUpdate(next)
    await expect(s.controller.playItem('headline-1')).rejects.toThrow('Salvarea setărilor')
    s.controller.commitSettingsUpdate(reserved)
    await s.controller.playItem('headline-1')
    await s.controller.stopTemplate('headline')
    const changed = { ...s.controller.getSettings(), headline: { ...s.controller.getSettings().headline!, buffers: {
      ...s.controller.getSettings().headline!.buffers,
      A: { ...s.controller.getSettings().headline!.buffers.A, contentName: 'New-A' },
    } } }
    s.controller.updateSettings(changed)
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'OFF', bufferItems: { A: null, B: null }, bufferFields: { A: null, B: null } })
  })

  it('cancels a failed settings save without applying candidate settings or leaving the lock set', async () => {
    const s = setup()
    const before = s.controller.getSettings()
    const candidate = { ...before, jsonDelayMs: 1000 as const }
    s.controller.reserveSettingsUpdate(candidate)
    s.controller.cancelSettingsUpdate()
    expect(s.controller.getSettings()).toEqual(before)
    await s.controller.playItem('headline-1')
  })
})
