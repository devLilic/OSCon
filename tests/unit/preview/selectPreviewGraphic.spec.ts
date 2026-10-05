import { describe, expect, it } from 'vitest'
import type { LabSnapshot } from '../../../src/shared/lab/contracts'
import { selectPreviewGraphic } from '../../../src/features/preview/selectPreviewGraphic'

const snapshot = (): LabSnapshot => ({
  revision: 1,
  activationOrder: ['headline', 'name'],
  templates: {
    headline: {
      state: 'ON_A', busy: false, personExpiresAt: null, activeItemId: 'headline-1', activeBuffer: 'A', hiddenBuffer: 'B',
      bufferItems: { A: 'headline-1', B: null }, bufferFields: { A: { primary: 'Kicker A', secondary: 'Titlu A' }, B: null }, lastError: null, confirmation: 'LOCAL/UNCONFIRMED',
    },
    name: {
      state: 'ON_B', busy: false, personExpiresAt: null, activeItemId: 'name-1', activeBuffer: 'B', hiddenBuffer: 'A',
      bufferItems: { A: null, B: 'name-1' }, bufferFields: { A: null, B: { primary: 'Nume', secondary: 'Funcție' } }, lastError: null, confirmation: 'LOCAL/UNCONFIRMED',
    },
  },
  presets: [],
  settings: { jsonDelayMs: 250, personDurationMs: 5000, headlineTransitionGapMs: 100, contentNames: { headline: 'HEADLINE', name: 'NAME' } },
  connection: { host: '127.0.0.1', port: 501, baseAddress: '/lvb/control/', liveBoardSenderHost: 'localhost' },
  jsonPaths: { headline: '', name: '' }, logPath: '', logPersistenceError: null, logs: [],
})

describe('selectPreviewGraphic', () => {
  it('shows the most recently activated template using committed active-buffer values', () => {
    expect(selectPreviewGraphic(snapshot())).toEqual({ type: 'name', primary: 'Nume', secondary: 'Funcție' })
  })

  it('shows no graphic while all templates remain UNKNOWN after startup', () => {
    const unknown = snapshot()
    unknown.activationOrder = []
    unknown.templates.headline.state = 'UNKNOWN'
    unknown.templates.headline.activeBuffer = null
    unknown.templates.headline.bufferFields = { A: { primary: 'Draft', secondary: 'Draft' }, B: null }
    unknown.templates.name.state = 'UNKNOWN'
    unknown.templates.name.activeBuffer = null
    unknown.templates.name.bufferFields = { A: null, B: { primary: 'Draft', secondary: 'Draft' } }

    expect(selectPreviewGraphic(unknown)).toBeNull()
  })
})
