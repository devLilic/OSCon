import { useEffect, useState } from 'react'
import type { GraphicItem, LabActionResult, TemplateSnapshot, TemplateType } from '@/shared/lab/contracts'
import { ro } from './ro'

export function TextPreview({ item }: { item: GraphicItem }) {
  return item.templateType === 'headline'
    ? <div className="text-preview">{item.fields.primary && <><span className="strap-kicker">{item.fields.primary}</span><br /></>}<span className="strap-title">{item.fields.secondary}</span></div>
    : <div className="text-preview"><span className="strap-name">{item.fields.primary} – {item.fields.secondary}</span></div>
}

function PresetEditor({ item, index, state, action, playLocked = false }: { item: GraphicItem; index: number; state: TemplateSnapshot; action: (call: () => Promise<LabActionResult>) => Promise<LabActionResult | null>; playLocked?: boolean }) {
  const [fields, setFields] = useState(item.fields)
  useEffect(() => { setFields(item.fields) }, [item.fields.primary, item.fields.secondary])
  const selected = item.id === state.activeItemId && state.state !== 'OFF'
  const activeFields = state.activeBuffer ? state.bufferFields[state.activeBuffer] : null
  const unchanged = selected && fields.primary === activeFields?.primary && fields.secondary === activeFields.secondary
  const labels = item.templateType === 'headline' ? [ro.kicker, ro.headlineTitle] : [ro.personName, ro.personRole]
  const canPlay = !state.busy && !playLocked && state.state !== 'UNKNOWN' && state.state !== 'NEEDS_RESYNC'
  return <article className={`preset ${selected ? 'selected' : ''}`}>
    <div className="preset-top"><span className="preset-number">{String(index + 1).padStart(2, '0')}</span><span className="preset-label">{item.label}</span><button className="play" disabled={!canPlay} aria-label={`PLAY ${item.label}`} onClick={() => void action(() => window.labApi.playItem(item.id, fields))}>{unchanged ? ro.active : ro.play}</button></div>
    <div className="preset-fields">
      <label>{labels[0]}<input aria-label={`${labels[0]} ${item.label}`} maxLength={2000} disabled={state.busy} value={fields.primary} onChange={event => setFields({ ...fields, primary: event.target.value })} /></label>
      <label>{labels[1]}<input aria-label={`${labels[1]} ${item.label}`} maxLength={2000} disabled={state.busy} value={fields.secondary} onChange={event => setFields({ ...fields, secondary: event.target.value })} /></label>
    </div>
    <TextPreview item={{ ...item, fields }} />
  </article>
}

export function TemplatePanel({ type, items, state, action, playLocked = false }: {
  type: TemplateType; items: GraphicItem[]; state: TemplateSnapshot; action: (call: () => Promise<LabActionResult>) => Promise<LabActionResult | null>; playLocked?: boolean
}) {
  const active = items.find(item => item.id === state.activeItemId)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!state.personExpiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [state.personExpiresAt])
  const personSeconds = state.personExpiresAt ? Math.max(0, Math.ceil((state.personExpiresAt - now) / 1000)) : null
  return <section className="template-panel panel" aria-label={type === 'headline' ? ro.headline : ro.name}>
    <div className="panel-heading"><div><span className="eyebrow">{type === 'headline' ? '01 / TITLURI' : '02 / NUME'}</span><h2>{type === 'headline' ? ro.headline : ro.name}</h2></div><button className="stop" disabled={state.busy} onClick={() => void action(() => window.labApi.stopTemplate(type))}>{ro.stop}</button></div>
    <div className="status-line"><span className={`dot ${state.state === 'UNKNOWN' ? 'unknown' : state.state === 'OFF' ? '' : 'on'}`} /><span>{state.busy ? ro.preparing : state.state === 'UNKNOWN' ? ro.unknownState : state.state === 'OFF' ? ro.off : state.state === 'NEEDS_RESYNC' ? ro.needsResync : ro.active}</span>{active && <strong>{active.label}</strong>}{state.personExpiresAt && <span className="person-countdown">{ro.personTimer}: {personSeconds}s</span>}</div>
    {state.state === 'NEEDS_RESYNC' && <p className="error" role="alert">{ro.needsResync}</p>}
    {playLocked && <p className="person-lock" role="status">{ro.personLock}</p>}
    <p className="muted small editor-hint">{ro.editHint}</p>
    <div className="presets">{items.map((item, index) => <PresetEditor key={item.id} item={item} index={index} state={state} action={action} playLocked={playLocked} />)}</div>
    {state.lastError && <p className="error" role="alert">{state.lastError}</p>}
    <p className="muted small">{ro.preview}</p>
  </section>
}
