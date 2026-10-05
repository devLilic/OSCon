import { randomUUID } from 'node:crypto'
import type { BufferId, GraphicFields, GraphicItem, HeadlineBufferConfig, LabSettings, TemplateSnapshot, TemplateState, TemplateType } from '../../../../src/shared/lab/contracts'
import { mergeGraphicFields, templateType, validateSettings } from '../../../../src/shared/lab/validation'
import type { GraphicsTransport, JsonDataSource, LabLog, PersonTextDataSource, PropagationBarrier } from './ports'
import type { HeadlineTextDataSource } from './ports'

function initialTemplate(): TemplateSnapshot {
  return { state: 'UNKNOWN', busy: false, activeItemId: null, activeBuffer: null, hiddenBuffer: null, bufferItems: { A: null, B: null }, bufferFields: { A: null, B: null }, personExpiresAt: null, lastError: null, confirmation: 'LOCAL/UNCONFIRMED' }
}

export class GraphicsController {
  private templates = { headline: initialTemplate(), name: initialTemplate() }
  /** Oldest to newest successful ON AIR intent; local state only. */
  private activationOrder: TemplateType[] = []
  private personReturnBuffer: BufferId | null = null
  private personExpiryTimer: ReturnType<typeof setTimeout> | null = null
  private settings: LabSettings
  private readonly presets: GraphicItem[]
  constructor(
    private readonly json: JsonDataSource,
    private readonly transport: GraphicsTransport,
    private readonly barrier: PropagationBarrier,
    private readonly log: LabLog,
    presets: GraphicItem[],
    settings: LabSettings,
    private readonly onChange: () => void = () => {},
    private readonly textDataSource?: HeadlineTextDataSource,
    private readonly personTextDataSource?: PersonTextDataSource,
  ) { this.settings = validateSettings(settings); this.presets = structuredClone(presets) }

  private settingsUpdateReserved = false
  private connectionUpdateReserved = false

  getTemplates() { return structuredClone(this.templates) }
  getActivationOrder() { return this.activationOrder.filter(type => this.templates[type].activeBuffer !== null) }
  getSettings() { return structuredClone(this.settings) }
  getPresets() { return structuredClone(this.presets) }

  async playItem(itemId: string, fields?: Partial<GraphicFields>): Promise<void> {
    const preset = this.presets.find(preset => preset.id === itemId)
    if (!preset) throw new Error('Item necunoscut.')
    const item = { ...preset, fields: mergeGraphicFields(fields, preset.fields) }
    const type = item.templateType
    this.assertIdle(type)
    const current = this.templates[type]
    if (current.state === 'UNKNOWN') throw new Error('Starea LiveBoard este necunoscută. Trimite STOP sau fă resync manual înainte de PLAY.')
    if (current.state === 'NEEDS_RESYNC') throw new Error('Starea Headline este ambiguă. Verifică LiveBoard și fă resync sau STOP.')
    const activeFields = current.activeBuffer ? current.bufferFields[current.activeBuffer] : null
    if (current.state !== 'OFF' && current.activeItemId === item.id && activeFields?.primary === item.fields.primary && activeFields.secondary === item.fields.secondary) {
      this.log.write('info', 'PLAY_NOOP', { template: type }); return
    }
    const before = { state: current.state, activeItemId: current.activeItemId, activeBuffer: current.activeBuffer, hiddenBuffer: current.hiddenBuffer }
    const previousHeadline = type === 'name' ? this.getRestorableHeadline() : null
    const headlineSnapshot = previousHeadline ? structuredClone(this.templates.headline) : null
    if (previousHeadline) this.templates.headline.busy = true
    const target: BufferId = current.state === 'OFF' ? 'A' : current.activeBuffer === 'A' ? 'B' : 'A'
    const command = current.state === 'OFF' ? 'play' : 'resume'
    const operationId = randomUUID()
    const delay = this.settings.jsonDelayMs
    const externalHeadline = type === 'headline' && this.settings.headline?.mode === 'external-txt'
    const externalPerson = type === 'name' && Boolean(this.settings.personText)
    const targetContent = externalHeadline ? this.headlineBuffer(target).contentName : this.settings.contentNames[type]
    const previousContent = externalHeadline && current.activeBuffer ? this.headlineBuffer(current.activeBuffer).contentName : null
    let externalCommandLabel: string | null = null
    current.busy = true
    current.lastError = null
    if (current.state !== 'OFF') this.transition(type, target === 'B' ? 'SWAPPING_A_B' : 'SWAPPING_B_A', operationId)
    else this.onChange()
    this.log.write('info', 'PLAY_INTENT', {
      operationId, template: type, target, command: externalHeadline ? 'play' : command,
      sequence: type === 'name' && previousHeadline
        ? ['write_person_txt_pair', 'person_txt_delay', 'resume_headline', 'transition_gap', 'play_person', 'person_timer', 'play_previous_headline']
        : externalHeadline && previousContent ? ['resume_previous', 'transition_gap', 'play_new'] : undefined,
      transitionGapMs: (externalHeadline && previousContent) || (type === 'name' && previousHeadline) ? this.settings.headlineTransitionGapMs : undefined,
      personDurationMs: type === 'name' ? this.settings.personDurationMs : undefined,
    })
    let externalSendAttempted = false
    let transportSendAttempted = false
    let personResumeSent = false
    let personPlayAttempted = false
    try {
      if (externalHeadline) {
        if (!this.textDataSource) throw new Error('Serviciul fișierelor TXT nu este disponibil.')
        await this.textDataSource.writePair(this.headlineBuffer(target), item.fields, operationId, target)
      } else if (externalPerson) {
        if (!this.personTextDataSource || !this.settings.personText) throw new Error('Serviciul fișierelor TXT Person nu este disponibil.')
        await this.personTextDataSource.writePersonPair(this.settings.personText.namePath, this.settings.personText.rolePath, item.fields, operationId)
      } else await this.json.writeBuffer(item, target, operationId)
      current.bufferItems[target] = itemId
      current.bufferFields[target] = { ...item.fields }
      this.onChange()
      await this.barrier.wait(delay, operationId)
      if (type === 'name' && previousHeadline) {
        personResumeSent = true
        transportSendAttempted = true
        await this.transport.send('resume', this.headlineContent(previousHeadline), operationId)
        await this.barrier.wait(this.settings.headlineTransitionGapMs, operationId)
        this.transition('headline', 'SUSPENDED_FOR_PERSON', operationId)
      }
      if (externalHeadline) {
        externalSendAttempted = true
        if (previousContent) {
          externalCommandLabel = 'RESUME pentru contentul anterior'
          transportSendAttempted = true
          try { await this.transport.send('resume', previousContent, operationId) }
          catch (error) { throw new Error(`${externalCommandLabel} a eșuat: ${error instanceof Error ? error.message : String(error)}`) }
          await this.barrier.wait(this.settings.headlineTransitionGapMs, operationId)
        }
        externalCommandLabel = 'PLAY pentru contentul nou'
        transportSendAttempted = true
        try { await this.transport.send('play', targetContent, operationId) }
        catch (error) { throw new Error(`${externalCommandLabel} a eșuat: ${error instanceof Error ? error.message : String(error)}`) }
      } else {
        if (type === 'name') personPlayAttempted = true
        transportSendAttempted = true
        await this.transport.send(command, targetContent, operationId)
      }
      preset.fields = { ...item.fields }
      current.activeBuffer = target
      current.hiddenBuffer = target === 'A' ? 'B' : 'A'
      current.activeItemId = itemId
      this.activationOrder = this.activationOrder.filter(activeType => activeType !== type)
      this.activationOrder.push(type)
      this.transition(type, target === 'A' ? 'ON_A' : 'ON_B', operationId)
      if (type === 'name') this.startPersonExpiry(previousHeadline, operationId)
    } catch (error) {
      if (externalHeadline) {
        const failedState = current.state
        const partial = (error as { partial?: boolean } | null)?.partial === true
        if (partial) {
          current.bufferItems[target] = null
          current.bufferFields[target] = null
        }
        Object.assign(current, before)
        if (externalSendAttempted) {
          current.state = failedState
          this.transition(type, 'NEEDS_RESYNC', operationId)
          this.log.write('warn', 'OSC_SEND_UNCERTAIN', { operationId, template: type, stage: externalCommandLabel, recovery: 'STOP or manual resync before another PLAY' })
        } else {
          this.log.write('warn', 'STATE_TRANSITION', { operationId, template: type, from: failedState, to: before.state, reason: partial ? 'partial_txt_pair' : 'operation_failed' })
          this.onChange()
        }
      } else {
        const failedState = current.state
        Object.assign(current, before)
        if (transportSendAttempted && (type !== 'name' || personPlayAttempted)) {
          current.state = 'NEEDS_RESYNC'
          current.lastError = 'Trimiterea OSC are rezultat incert. Fă STOP sau resync manual.'
          this.log.write('warn', 'OSC_SEND_UNCERTAIN', { operationId, template: type, recovery: 'STOP or manual resync before another PLAY' })
        } else {
          this.log.write('warn', 'STATE_TRANSITION', { operationId, template: type, from: failedState, to: before.state, reason: 'operation_failed' })
        }
        if (personResumeSent) {
          const headline = this.templates.headline
          headline.state = 'NEEDS_RESYNC'
          headline.lastError = 'Tranziția către Person a eșuat după RESUME-ul titlului precedent.'
          if (personPlayAttempted) {
            current.state = 'NEEDS_RESYNC'
            current.lastError = 'PLAY Person cu rezultat neconfirmat.'
          } else if (headlineSnapshot) {
            headline.activeItemId = headlineSnapshot.activeItemId
            headline.activeBuffer = headlineSnapshot.activeBuffer
            headline.hiddenBuffer = headlineSnapshot.hiddenBuffer
          }
          this.onChange()
        }
      }
      this.fail(type, error, operationId)
      throw error
    } finally { current.busy = false; if (previousHeadline) this.templates.headline.busy = false; this.onChange() }
  }

  async stopTemplate(value: TemplateType): Promise<void> {
    const type = templateType(value)
    this.assertIdle(type, type === 'name')
    const current = this.templates[type]
    const personReturn = type === 'name' ? this.personReturnBuffer : null
    const operationId = randomUUID()
    current.busy = true
    current.lastError = null
    this.onChange()
    try {
      if (type === 'headline' && this.settings.headline?.mode === 'external-txt') {
        const names = [this.headlineBuffer('A').contentName, this.headlineBuffer('B').contentName]
        const failures: string[] = []
        for (const content of names) {
          try { await this.transport.send('stop', content, operationId) }
          catch (error) { failures.push(`${content}: ${error instanceof Error ? error.message : String(error)}`) }
        }
        if (failures.length) throw new Error(`STOP nereușit: ${failures.join('; ')}`)
        } else await this.transport.send('stop', this.settings.contentNames[type], operationId)
      current.activeBuffer = null
      current.hiddenBuffer = null
      current.activeItemId = null
      this.activationOrder = this.activationOrder.filter(activeType => activeType !== type)
      this.transition(type, 'OFF', operationId)
      if (type === 'name' && this.personExpiryTimer) {
        clearTimeout(this.personExpiryTimer)
        this.personExpiryTimer = null
        current.personExpiresAt = null
        this.personReturnBuffer = null
        if (personReturn) await this.restoreHeadlineAfterPerson(personReturn, operationId)
      }
    } catch (error) {
      if (type === 'headline' && this.settings.headline?.mode === 'external-txt') this.transition(type, 'NEEDS_RESYNC', operationId)
      else current.state = 'NEEDS_RESYNC'
      this.fail(type, error, operationId); throw error
    }
    finally { current.busy = false; this.onChange() }
  }

  resync(value: TemplateType, active: BufferId | 'OFF'): void {
    const type = templateType(value)
    if (!['A', 'B', 'OFF'].includes(active)) throw new Error('Buffer invalid.')
    this.assertIdle(type)
    const current = this.templates[type]
    current.activeBuffer = active === 'OFF' ? null : active
    current.hiddenBuffer = active === 'OFF' ? null : active === 'A' ? 'B' : 'A'
    current.activeItemId = active === 'OFF' ? null : current.bufferItems[active]
    this.activationOrder = this.activationOrder.filter(activeType => activeType !== type)
    if (active !== 'OFF') this.activationOrder.push(type)
    const knownFields = active === 'OFF' ? null : current.bufferFields[active]
    const preset = this.presets.find(item => item.id === current.activeItemId)
    if (preset && knownFields) preset.fields = { ...knownFields }
    current.lastError = null
    this.transition(type, active === 'OFF' ? 'OFF' : active === 'A' ? 'ON_A' : 'ON_B', randomUUID())
      this.log.write('warn', 'RESYNC', { template: type, active, confirmation: current.confirmation })
  }

  prepareSettingsUpdate(value: LabSettings): LabSettings {
    if (this.settingsUpdateReserved) throw new Error('Salvarea setărilor este în curs.')
    if (this.connectionUpdateReserved) throw new Error('Salvarea conexiunii este în curs.')
    this.assertIdle('headline'); this.assertIdle('name')
    const next = validateSettings(value)
    const oldHeadline = this.settings.headline?.mode ?? 'internal-json'
    const newHeadline = next.headline?.mode ?? 'internal-json'
    if ((oldHeadline !== newHeadline || JSON.stringify(this.settings.headline) !== JSON.stringify(next.headline)) && !isStoppedOrUnknown(this.templates.headline.state)) {
      throw new Error('Oprește Headline înainte să schimbi modul, contenturile sau căile TXT.')
    }
    for (const type of ['headline', 'name'] as const) {
      if (next.contentNames[type] !== this.settings.contentNames[type] && !isStoppedOrUnknown(this.templates[type].state)) {
        throw new Error('Oprește template-ul înainte să schimbi numele contentului.')
      }
    }
    if (JSON.stringify(next.personText) !== JSON.stringify(this.settings.personText) && !isStoppedOrUnknown(this.templates.name.state)) {
      throw new Error('Oprește Person înainte să schimbi căile fișierelor TXT.')
    }
    return next
  }

  reserveSettingsUpdate(value: LabSettings): LabSettings {
    const next = this.prepareSettingsUpdate(value)
    this.settingsUpdateReserved = true
    return next
  }

  commitSettingsUpdate(value: LabSettings): void {
    if (!this.settingsUpdateReserved) throw new Error('Nu există salvare de setări rezervată.')
    const next = validateSettings(value)
    this.applySettings(next)
    this.settingsUpdateReserved = false
  }

  cancelSettingsUpdate(): void { this.settingsUpdateReserved = false }

  reserveConnectionSettingsUpdate(): void {
    if (this.connectionUpdateReserved || this.settingsUpdateReserved) throw new Error('Salvarea configurației este deja în curs.')
    this.assertIdle('headline')
    this.assertIdle('name')
    if (this.templates.headline.state !== 'OFF' && this.templates.headline.state !== 'UNKNOWN' ||
        this.templates.name.state !== 'OFF' && this.templates.name.state !== 'UNKNOWN') {
      throw new Error('Oprește ambele template-uri înainte să schimbi conexiunea LiveBoard.')
    }
    this.connectionUpdateReserved = true
  }

  commitConnectionSettingsUpdate(_reservation?: void): void {
    if (!this.connectionUpdateReserved) throw new Error('Nu există salvare de conexiune rezervată.')
    this.connectionUpdateReserved = false
    this.onChange()
  }

  cancelConnectionSettingsUpdate(_reservation?: void): void { this.connectionUpdateReserved = false }

  invalidateConnectionState(): void {
    if (!this.connectionUpdateReserved) throw new Error('Rezervă schimbarea conexiunii înainte de invalidarea stării.')
    for (const type of ['headline', 'name'] as const) {
      const current = this.templates[type]
      current.state = 'UNKNOWN'
      current.activeItemId = null
      current.activeBuffer = null
      current.hiddenBuffer = null
      current.bufferItems = { A: null, B: null }
      current.bufferFields = { A: null, B: null }
      current.lastError = null
    }
    this.activationOrder = []
    this.log.write('warn', 'CONNECTION_CHANGED', { state: 'UNKNOWN', confirmation: 'LOCAL/UNCONFIRMED' })
    this.onChange()
  }

  updateSettings(value: LabSettings): void {
    const next = this.prepareSettingsUpdate(value)
    this.applySettings(next)
  }

  private applySettings(next: LabSettings): void {
    const clearHeadline = JSON.stringify(this.settings.headline) !== JSON.stringify(next.headline) || this.settings.contentNames.headline !== next.contentNames.headline
    const clearName = this.settings.contentNames.name !== next.contentNames.name || JSON.stringify(this.settings.personText) !== JSON.stringify(next.personText)
    this.settings = next
    if (clearHeadline) this.clearBufferMetadata('headline')
    if (clearName) this.clearBufferMetadata('name')
    this.log.write('info', 'SETTINGS_CHANGED', { headlineChanged: clearHeadline, nameChanged: clearName })
    this.onChange()
  }

  private clearBufferMetadata(type: TemplateType): void {
    const current = this.templates[type]
    current.activeBuffer = null; current.hiddenBuffer = null; current.activeItemId = null
    current.bufferItems = { A: null, B: null }; current.bufferFields = { A: null, B: null }
    this.activationOrder = this.activationOrder.filter(activeType => activeType !== type)
  }

  private assertIdle(type: TemplateType, allowPersonStop = false) {
    if (this.settingsUpdateReserved) throw new Error('Salvarea setărilor este în curs.')
    if (this.connectionUpdateReserved) throw new Error('Salvarea conexiunii este în curs.')
    if (this.templates[type].busy) {
      this.log.write('warn', 'BUSY_REJECTED', { template: type })
      throw new Error('Template ocupat. Așteaptă finalizarea operației.')
    }
    if (this.personExpiryTimer && !allowPersonStop && (type === 'headline' || type === 'name')) {
      this.log.write('warn', 'PERSON_LOCK_REJECTED', { template: type, personExpiresAt: this.templates.name.personExpiresAt })
      throw new Error(type === 'headline' ? 'Headline este blocat până la expirarea Person și revenirea titlului.' : 'Person este deja activ; așteaptă revenirea automată la titlu.')
    }
  }
  private headlineBuffer(buffer: BufferId): HeadlineBufferConfig {
    const config = this.settings.headline?.buffers?.[buffer]
    if (!config) throw new Error(`Configurația Headline ${buffer} lipsește.`)
    return config
  }
  private transition(type: TemplateType, state: TemplateState, operationId: string) {
    const previous = this.templates[type].state
    this.templates[type].state = state
    this.log.write('info', 'STATE_TRANSITION', { operationId, template: type, from: previous, to: state, confirmation: 'LOCAL/UNCONFIRMED' })
    this.onChange()
  }
  private getRestorableHeadline(): BufferId | null {
    const headline = this.templates.headline
    if (headline.state === 'ON_A' || headline.state === 'ON_B') return headline.activeBuffer
    return null
  }

  private headlineContent(buffer: BufferId): string {
    if (this.settings.headline?.mode === 'external-txt') return this.headlineBuffer(buffer).contentName
    return this.settings.contentNames.headline
  }

  private startPersonExpiry(previousHeadline: BufferId | null, operationId: string): void {
    this.personReturnBuffer = previousHeadline
    const name = this.templates.name
    name.personExpiresAt = Date.now() + this.settings.personDurationMs
    this.log.write('info', 'PERSON_TIMER_STARTED', { operationId, durationMs: this.settings.personDurationMs, expiresAt: new Date(name.personExpiresAt).toISOString(), returnBuffer: previousHeadline })
    this.personExpiryTimer = setTimeout(() => { void this.expirePerson() }, this.settings.personDurationMs)
  }

  private async expirePerson(): Promise<void> {
    const operationId = randomUUID()
    const returnBuffer = this.personReturnBuffer
    this.personExpiryTimer = null
    this.personReturnBuffer = null
    const name = this.templates.name
    name.busy = true
    name.personExpiresAt = null
    name.activeBuffer = null
    name.hiddenBuffer = null
    name.activeItemId = null
    this.activationOrder = this.activationOrder.filter(type => type !== 'name')
    this.transition('name', 'OFF', operationId)
    this.log.write('info', 'PERSON_TIMER_EXPIRED', { operationId, returnBuffer, automatic: true })
    try {
      if (returnBuffer) await this.restoreHeadlineAfterPerson(returnBuffer, operationId)
    } catch (error) {
      this.log.write('error', 'PERSON_RETURN_FAILED', { operationId, message: error instanceof Error ? error.message : String(error) })
    } finally { name.busy = false; this.onChange() }
  }

  private async restoreHeadlineAfterPerson(buffer: BufferId, operationId: string): Promise<void> {
    const headline = this.templates.headline
    headline.busy = true
    try {
      await this.transport.send('play', this.headlineContent(buffer), operationId)
      headline.activeBuffer = buffer
      headline.hiddenBuffer = buffer === 'A' ? 'B' : 'A'
      this.activationOrder = this.activationOrder.filter(type => type !== 'headline')
      this.activationOrder.push('headline')
      this.transition('headline', buffer === 'A' ? 'ON_A' : 'ON_B', operationId)
      this.log.write('info', 'PERSON_RETURNED_TO_HEADLINE', { operationId, buffer, confirmation: 'LOCAL/UNCONFIRMED' })
      this.onChange()
    } catch (error) {
      headline.state = 'NEEDS_RESYNC'
      this.fail('headline', error, operationId)
      throw error
    } finally { headline.busy = false; this.onChange() }
  }

  dispose(): void {
    if (this.personExpiryTimer) clearTimeout(this.personExpiryTimer)
    this.personExpiryTimer = null
    this.personReturnBuffer = null
  }
  private fail(type: TemplateType, error: unknown, operationId: string) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'OPERATION_FAILED'
    this.templates[type].lastError = 'Operația a eșuat. Consultă etapa și codul erorii în diagnostic.'
    this.log.write('error', 'ERROR', { operationId, template: type, state: this.templates[type].state, code })
  }
}

function isStoppedOrUnknown(state: TemplateState): boolean {
  return state === 'OFF' || state === 'UNKNOWN'
}
