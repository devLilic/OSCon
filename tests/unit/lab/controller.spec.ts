import { describe, expect, it, vi } from 'vitest'
import { GraphicsController } from '../../../electron/main/modules/lab/GraphicsController'
import { LAB_PRESETS, DEFAULT_LAB_SETTINGS } from '../../../config/lab'

function setup() {
  const order: string[] = []
  const writeBuffer = vi.fn(async () => { order.push('json') })
  const send = vi.fn(async () => { order.push('osc') })
  const wait = vi.fn(async () => { order.push('delay') })
  const log = { write: vi.fn() }
  const controller = new GraphicsController({ writeBuffer }, { send }, { wait }, log, LAB_PRESETS, DEFAULT_LAB_SETTINGS)
  controller.resync('headline', 'OFF')
  controller.resync('name', 'OFF')
  return { controller, writeBuffer, send, wait, order, log }
}

describe('LAB operator intents', () => {
  it('starts unknown and requires an explicit STOP or resync before first PLAY', async () => {
    const writeBuffer = vi.fn(async () => {})
    const send = vi.fn(async () => {})
    const controller = new GraphicsController({ writeBuffer }, { send }, { wait: async () => {} }, { write: vi.fn() }, LAB_PRESETS, DEFAULT_LAB_SETTINGS)
    expect(controller.getTemplates().headline.state).toBe('UNKNOWN')
    await expect(controller.playItem('headline-1')).rejects.toThrow('STOP sau fă resync manual')
    expect(writeBuffer).not.toHaveBeenCalled()
    await controller.stopTemplate('headline')
    await controller.playItem('headline-1')
    expect(controller.getTemplates().headline.state).toBe('ON_A')
  })

  it('allows explicit settings repair while startup state is unknown without sending OSC', () => {
    const send = vi.fn(async () => {})
    const controller = new GraphicsController({ writeBuffer: async () => {} }, { send }, { wait: async () => {} }, { write: vi.fn() }, LAB_PRESETS, DEFAULT_LAB_SETTINGS)
    controller.updateSettings({ ...DEFAULT_LAB_SETTINGS, contentNames: { headline: 'REPAIRED_HEADLINE', name: 'REPAIRED_NAME' } })
    expect(controller.getSettings().contentNames.headline).toBe('REPAIRED_HEADLINE')
    expect(controller.getTemplates().headline.state).toBe('UNKNOWN')
    expect(send).not.toHaveBeenCalled()
  })

  it('marks internal JSON PLAY uncertain after a failed UDP send', async () => {
    const s = setup()
    s.send.mockRejectedValueOnce(new Error('UDP failure'))
    await expect(s.controller.playItem('headline-1')).rejects.toThrow('UDP failure')
    expect(s.controller.getTemplates().headline.state).toBe('NEEDS_RESYNC')
    await expect(s.controller.playItem('headline-1')).rejects.toThrow('ambiguă')
  })

  it('marks Person uncertain after a failed UDP send even with no returning headline', async () => {
    const s = setup()
    s.send.mockRejectedValueOnce(new Error('UDP failure'))
    await expect(s.controller.playItem('name-1')).rejects.toThrow('UDP failure')
    expect(s.controller.getTemplates().name.state).toBe('NEEDS_RESYNC')
  })
  it('writes initial A, waits, plays, then swaps to hidden B and back to A', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    expect(s.order).toEqual(['json', 'delay', 'osc'])
    expect(s.send).toHaveBeenLastCalledWith('play', 'L3_HEADLINE', expect.any(String))
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'ON_A', activeBuffer: 'A', hiddenBuffer: 'B' })
    await s.controller.playItem('headline-2')
    expect(s.writeBuffer).toHaveBeenLastCalledWith(LAB_PRESETS[1], 'B', expect.any(String))
    expect(s.send).toHaveBeenLastCalledWith('resume', 'L3_HEADLINE', expect.any(String))
    await s.controller.playItem('headline-3')
    expect(s.writeBuffer).toHaveBeenLastCalledWith(LAB_PRESETS[2], 'A', expect.any(String))
    expect(s.controller.getTemplates().headline.state).toBe('ON_A')
    expect(s.wait).toHaveBeenCalledWith(250, expect.any(String))
  })

  it('makes PLAY of the active item a no-op; STOP resets next IN to A', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    await s.controller.playItem('headline-1')
    expect(s.send).toHaveBeenCalledTimes(1)
    expect(s.writeBuffer).toHaveBeenCalledTimes(1)
    await s.controller.stopTemplate('headline')
    expect(s.send).toHaveBeenLastCalledWith('stop', 'L3_HEADLINE', expect.any(String))
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'OFF', activeItemId: null, activeBuffer: null })
    await s.controller.playItem('headline-2')
    expect(s.send).toHaveBeenLastCalledWith('play', 'L3_HEADLINE', expect.any(String))
  })

  it('swaps the same item after editing title, kicker or both, preserving the companion text', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    await s.controller.playItem('headline-1', { secondary: 'Titlu schimbat' })
    expect(s.writeBuffer).toHaveBeenLastCalledWith(expect.objectContaining({ fields: { primary: LAB_PRESETS[0].fields.primary, secondary: 'Titlu schimbat' } }), 'B', expect.any(String))
    await s.controller.playItem('headline-1', { primary: 'KICKER SCHIMBAT' })
    expect(s.writeBuffer).toHaveBeenLastCalledWith(expect.objectContaining({ fields: { primary: 'KICKER SCHIMBAT', secondary: 'Titlu schimbat' } }), 'A', expect.any(String))
    await s.controller.playItem('headline-1', { primary: '', secondary: 'Alt titlu' })
    expect(s.writeBuffer).toHaveBeenLastCalledWith(expect.objectContaining({ fields: { primary: '', secondary: 'Alt titlu' } }), 'B', expect.any(String))
    expect(s.send).toHaveBeenNthCalledWith(1, 'play', 'L3_HEADLINE', expect.any(String))
    for (const call of [2, 3, 4]) expect(s.send).toHaveBeenNthCalledWith(call, 'resume', 'L3_HEADLINE', expect.any(String))
    await s.controller.playItem('headline-1')
    expect(s.send).toHaveBeenCalledTimes(4)
    expect(s.controller.getPresets()[0].fields).toEqual({ primary: '', secondary: 'Alt titlu' })
    expect(LAB_PRESETS[0].fields.primary).not.toBe('')
  })

  it('failed edited-item swap preserves the active text version and can be retried explicitly', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    s.send.mockRejectedValueOnce(new Error('send failed'))
    await expect(s.controller.playItem('headline-1', { secondary: 'Nou' })).rejects.toThrow('send failed')
    expect(s.controller.getTemplates().headline.bufferFields.A).toEqual(LAB_PRESETS[0].fields)
    expect(s.controller.getPresets()[0].fields).toEqual(LAB_PRESETS[0].fields)
    s.controller.resync('headline', 'A')
    await s.controller.playItem('headline-1', { secondary: 'Nou' })
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'ON_B', bufferFields: { B: { secondary: 'Nou' } } })
    expect(s.send).toHaveBeenCalledTimes(3)
  })

  it('rejects invalid text before any JSON or OSC operation', async () => {
    const s = setup()
    for (const fields of [{ primary: 123 }, { secondary: 'x'.repeat(2001) }, { primary: '\0' }, { unknown: 'x' }]) {
      await expect(s.controller.playItem('headline-1', fields as never)).rejects.toThrow()
    }
    expect(s.writeBuffer).not.toHaveBeenCalled()
    expect(s.send).not.toHaveBeenCalled()
  })

  it('partial edits after resync preserve the text version in the manually selected buffer', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    s.send.mockRejectedValueOnce(new Error('ambiguous send'))
    await expect(s.controller.playItem('headline-1', { secondary: 'Pregătit în B' })).rejects.toThrow()
    s.controller.resync('headline', 'B')
    await s.controller.playItem('headline-1', { primary: 'Kicker nou' })
    expect(s.writeBuffer).toHaveBeenLastCalledWith(expect.objectContaining({ fields: { primary: 'Kicker nou', secondary: 'Pregătit în B' } }), 'A', expect.any(String))
  })

  it('blocks overlapping initial PLAY, STOP, settings and resync, while Name remains independent', async () => {
    const s = setup()
    let release!: () => void
    s.wait.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const pending = s.controller.playItem('headline-1')
    await Promise.resolve()
    await expect(s.controller.playItem('headline-2')).rejects.toThrow('ocupat')
    await expect(s.controller.stopTemplate('headline')).rejects.toThrow('ocupat')
    expect(() => s.controller.resync('headline', 'B')).toThrow('ocupat')
    expect(() => s.controller.updateSettings({ ...DEFAULT_LAB_SETTINGS, jsonDelayMs: 500 })).toThrow('ocupat')
    await s.controller.playItem('name-1')
    expect(s.controller.getTemplates().name.state).toBe('ON_A')
    release()
    await pending
  })

  it('exposes directional SWAPPING and rejects all extra PLAY until delay completes', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    let release!: () => void
    s.wait.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const pending = s.controller.playItem('headline-2')
    await Promise.resolve()
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'SWAPPING_A_B', activeBuffer: 'A', busy: true })
    await expect(s.controller.playItem('headline-1')).rejects.toThrow('ocupat')
    release()
    await pending
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'ON_B', busy: false })
  })

  it('does not send on JSON failure; failed RESUME marks the state uncertain and blocks retry', async () => {
    const s = setup()
    s.writeBuffer.mockRejectedValueOnce(new Error('disk locked'))
    await expect(s.controller.playItem('headline-1')).rejects.toThrow('disk locked')
    expect(s.send).not.toHaveBeenCalled()
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'OFF', busy: false, lastError: expect.not.stringContaining('disk locked') })
    await s.controller.playItem('headline-1')
    s.send.mockRejectedValueOnce(new Error('UDP error'))
    await expect(s.controller.playItem('headline-2')).rejects.toThrow('UDP error')
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'NEEDS_RESYNC', busy: false, activeItemId: 'headline-1', lastError: expect.not.stringContaining('UDP error') })
    expect(s.send).toHaveBeenCalledTimes(2)
    s.controller.resync('headline', 'B')
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'ON_B', activeItemId: 'headline-2', confirmation: 'LOCAL/UNCONFIRMED' })
  })

  it('failed STOP preserves state; STOP is also sent from local OFF for recovery', async () => {
    const s = setup()
    await s.controller.stopTemplate('headline')
    expect(s.send).toHaveBeenCalledTimes(1)
    await s.controller.playItem('headline-1')
    s.send.mockRejectedValueOnce(new Error('failed stop'))
    await expect(s.controller.stopTemplate('headline')).rejects.toThrow('failed stop')
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'NEEDS_RESYNC', activeItemId: 'headline-1', busy: false })
  })

  it('invalidates cached state after a confirmed receiver configuration change', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    await s.controller.stopTemplate('headline')
    const sends = s.send.mock.calls.length
    s.controller.reserveConnectionSettingsUpdate()
    s.controller.invalidateConnectionState()
    s.controller.commitConnectionSettingsUpdate()
    expect(s.send).toHaveBeenCalledTimes(sends)
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'UNKNOWN', activeItemId: null, activeBuffer: null, bufferItems: { A: null, B: null }, bufferFields: { A: null, B: null } })
    expect(s.controller.getTemplates().name.state).toBe('UNKNOWN')
  })

  it('resync only changes local state, preserves unknown item, rejects invalid settings/ids', async () => {
    const s = setup()
    s.controller.resync('headline', 'B')
    expect(s.controller.getTemplates().headline).toMatchObject({ state: 'ON_B', activeItemId: null })
    expect(s.send).not.toHaveBeenCalled()
    expect(s.writeBuffer).not.toHaveBeenCalled()
    s.controller.resync('headline', 'OFF')
    expect(() => s.controller.updateSettings({ ...DEFAULT_LAB_SETTINGS, jsonDelayMs: 123 as 250 })).toThrow()
    expect(() => s.controller.updateSettings({ ...DEFAULT_LAB_SETTINGS, contentNames: { headline: 'same', name: 'same' } })).toThrow()
    await expect(s.controller.playItem('unknown')).rejects.toThrow()
  })

  it('reserves LiveBoard connection changes only while stopped and blocks commands until commit/cancel', async () => {
    const s = setup()
    await s.controller.playItem('headline-1')
    expect(() => s.controller.reserveConnectionSettingsUpdate()).toThrow('Oprește ambele template-uri')
    await s.controller.stopTemplate('headline')
    s.controller.reserveConnectionSettingsUpdate()
    await expect(s.controller.playItem('headline-2')).rejects.toThrow('Salvarea conexiunii')
    await expect(s.controller.stopTemplate('name')).rejects.toThrow('Salvarea conexiunii')
    s.controller.commitConnectionSettingsUpdate()
    await s.controller.playItem('headline-2')
    await s.controller.stopTemplate('headline')
    s.controller.reserveConnectionSettingsUpdate()
    s.controller.cancelConnectionSettingsUpdate()
    await s.controller.playItem('headline-1')
  })
})
