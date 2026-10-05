import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSocket } from 'node:dgram'
import { JsonDataSourceService } from '../../../electron/main/modules/lab/JsonDataSourceService'
import { LiveBoardOscService, encodeOscMessage, validateLiveBoardConnection } from '../../../electron/main/modules/lab/LiveBoardOscService'
import { LAB_CONNECTION, LAB_PRESETS } from '../../../config/lab'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
const log = { write() {} }

describe('LAB JSON and OSC', () => {
  it('uses the corrected OSC receiver destination and keeps the configured LiveBoard sender host', () => {
    expect(LAB_CONNECTION.port).toBe(501)
    expect(LAB_CONNECTION.liveBoardSenderHost).toBe('localhost:601')
  })

  it('replaces only hidden fields, preserves Unicode/other keys, rejects corrupt JSON without overwriting', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'liveboard-lab-'))
    directories.push(dir)
    const service = new JsonDataSourceService(dir, log)
    await service.initialize()
    await service.writeBuffer(LAB_PRESETS[0], 'A', 'op-1')
    const file = service.paths.headline
    const a = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...a, extra: 'preserved' }))
    await service.writeBuffer(LAB_PRESETS[1], 'B', 'op-2')
    const b = JSON.parse(await readFile(file, 'utf8'))
    expect(b.KICKER_A).toBe(a.KICKER_A)
    expect(b.TITLE_A).toBe(a.TITLE_A)
    expect(b.KICKER_B).toBe(LAB_PRESETS[1].fields.primary)
    expect(b.TITLE_B).toBe(LAB_PRESETS[1].fields.secondary)
    expect(b.extra).toBe('preserved')
    await writeFile(file, '{broken')
    await expect(service.writeBuffer(LAB_PRESETS[2], 'A', 'op-3')).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('{broken')
  })

  it('initialization preserves files, rejects missing fields, and writes Name independently', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'liveboard-lab-'))
    directories.push(dir)
    const service = new JsonDataSourceService(dir, log)
    await service.initialize()
    await service.writeBuffer(LAB_PRESETS[4], 'B', 'name-1')
    await service.initialize()
    const name = JSON.parse(await readFile(service.paths.name, 'utf8'))
    expect(name.NAME_B).toBe(LAB_PRESETS[4].fields.primary)
    await writeFile(service.paths.headline, '{}')
    await expect(service.writeBuffer(LAB_PRESETS[0], 'A', 'invalid')).rejects.toThrow()
  })

  it('encodes type tags, NUL and 4-byte padding using an independently specified packet', () => {
    expect(encodeOscMessage('/lvb/control/play', ['L3_HEADLINE'])).toEqual(
      Buffer.from('/lvb/control/play\0\0\0,s\0\0L3_HEADLINE\0', 'utf8'),
    )
    expect(() => encodeOscMessage('/lvb/control/play', ['bad\0name'])).toThrow()
  })

  it('sends actual OSC UDP to loopback with the content string', async () => {
    const receiver = createSocket('udp4')
    await new Promise<void>(resolve => receiver.bind(0, '127.0.0.1', resolve))
    const transport = new LiveBoardOscService(log, { host: '127.0.0.1', port: receiver.address().port })
    try {
      const packet = new Promise<Buffer>(resolve => receiver.once('message', resolve))
      await transport.send('resume', 'L3_NAME', 'udp-test')
      const data = await packet
      expect(data.toString('utf8').split('\0').filter(Boolean)).toEqual(['/lvb/control/resume', ',s', 'L3_NAME'])
    } finally { transport.close(); receiver.close() }
  })

  it('logs OSC destination metadata without exposing the content name', async () => {
    const receiver = createSocket('udp4')
    await new Promise<void>(resolve => receiver.bind(0, '127.0.0.1', resolve))
    const entries: Array<{ event: string; details: Record<string, unknown> }> = []
    const transport = new LiveBoardOscService({ write: (_level, event, details) => entries.push({ event, details: details ?? {} }) }, { host: '127.0.0.1', port: receiver.address().port })
    try {
      const packet = new Promise<void>(resolve => receiver.once('message', () => resolve()))
      await transport.send('play', '01_X_Titlu1', 'typed-log')
      await packet
      const sent = entries.find(entry => entry.event === 'OSC_SEND_BEGIN')!
      expect(sent.details).toMatchObject({
        direction: 'out', address: '/lvb/control/play', target: { host: '127.0.0.1', port: receiver.address().port },
      })
      expect(JSON.stringify(entries)).not.toContain('01_X_Titlu1')
    } finally { transport.close(); receiver.close() }
  })

  it('validates a receiver host/port/prefix and uses updated settings for future sends', async () => {
    expect(validateLiveBoardConnection({ host: 'localhost', port: 501 })).toEqual({ host: 'localhost', port: 501, addressPrefix: '/lvb/control/' })
    for (const invalid of [
      { host: 'bad host', port: 501 },
      { host: 'localhost', port: 0 },
      { host: 'localhost', port: 501, addressPrefix: '/bad*/' },
    ]) expect(() => validateLiveBoardConnection(invalid)).toThrow()

    const receiver = createSocket('udp4')
    await new Promise<void>(resolve => receiver.bind(0, '127.0.0.1', resolve))
    const transport = new LiveBoardOscService(log, { host: '127.0.0.1', port: receiver.address().port })
    try {
      transport.updateConnection({ host: '127.0.0.1', port: receiver.address().port, addressPrefix: '/oscon/control/' })
      const packet = new Promise<Buffer>(resolve => receiver.once('message', resolve))
      await transport.send('play', 'L3_HEADLINE', 'prefix-test')
      expect((await packet).toString('utf8').split('\0').filter(Boolean)[0]).toBe('/oscon/control/play')
    } finally { transport.close(); receiver.close() }
  })
})
