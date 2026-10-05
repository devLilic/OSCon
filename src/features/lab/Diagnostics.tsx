import { useEffect, useState } from 'react'
import type { BridgeInfo } from '@/shared/lab/bridgeContracts'
import type { LabActionResult, LabSnapshot, TemplateType } from '@/shared/lab/contracts'
import { ro } from './ro'

type Action = (call: () => Promise<LabActionResult>) => Promise<LabActionResult | null>

const stateCaption = (state: string) => state === 'UNKNOWN' ? ro.unknownState : state === 'OFF' ? ro.off : state === 'NEEDS_RESYNC' ? ro.needsResync : state

export function Diagnostics({ snapshot, action }: { snapshot: LabSnapshot; action: Action }) {
  const [bridge, setBridge] = useState<BridgeInfo | null>(null)
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  useEffect(() => {
    let disposed = false
    void window.labApi.getBridgeInfo().then(info => { if (!disposed) setBridge(info) }).catch(reason => { if (!disposed) setBridgeError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { disposed = true }
  }, [])

  return <section className="diagnostics-page">
    <div className="page-heading"><div><span className="eyebrow">{ro.localOperations}</span><h2>{ro.diagnosticTitle}</h2><p>{ro.diagnosticIntro}</p></div><span className="unconfirmed-banner"><span />{ro.confirmation}</span></div>
    <section className="settings-card">
      <div className="settings-card-heading"><div><span className="eyebrow">{ro.serviceSection}</span><h3>{ro.osconConnection}</h3></div><span className={`connection-state ${bridge?.status ?? 'offline'}`}><i />{bridge?.status ?? 'offline'}</span></div>
      {bridgeError && <p className="error" role="alert">{bridgeError}</p>}
      {bridge && <div className="diagnostic-grid"><div><small>{ro.endpoint}</small><strong>{bridge.endpoint}</strong></div><div><small>{ro.allowedOriginsLabel}</small><strong>{bridge.allowedOrigins.join(', ') || '—'}</strong></div><div><small>{ro.receiverOsc}</small><strong>{bridge.receiver.host}:{bridge.receiver.port}</strong><code>{bridge.receiver.addressPrefix}</code></div><div><small>{ro.setupLabel}</small><strong>{bridge.setupConfirmed ? ro.setupConfirmed : ro.setupUnverified}</strong></div></div>}
      {bridge?.error && <p className="error" role="alert">{bridge.error}</p>}
    </section>

    <section className="settings-card">
      <div className="settings-card-heading"><div><span className="eyebrow">{ro.manualResyncSection}</span><h3>{ro.manualResync}</h3></div><span className="small muted">{ro.initialStateUnknown}</span></div>
      <p className="section-description">{ro.manualResyncHint}</p>
      <div className="resync-grid">{(['headline', 'name'] as TemplateType[]).map(type => {
        const template = snapshot.templates[type]
        const title = type === 'headline' ? ro.headline : ro.name
        const disabled = template.busy || template.personExpiresAt !== null
        return <article className="resync-card" key={type}>
          <div className="resync-card-title"><div><small>{type === 'headline' ? ro.titleTemplate : ro.personTemplate}</small><h4>{title}</h4></div><span className={`state-chip ${template.state.toLowerCase().replaceAll('_', '-')}`}>{stateCaption(template.state)}</span></div>
          {template.state === 'NEEDS_RESYNC' && <p className="error" role="alert">{ro.needsResync}</p>}
          <div className="resync-card-meta"><span>{ro.activeBufferLabel}<strong>{template.activeBuffer ?? '—'}</strong></span><span>{ro.hiddenBufferLabel}<strong>{template.hiddenBuffer ?? '—'}</strong></span>{template.personExpiresAt && <span>{ro.personExpires}<strong>{new Date(template.personExpiresAt).toLocaleTimeString()}</strong></span>}</div>
          <div className="resync-buttons"><button type="button" disabled={disabled} onClick={() => void action(() => window.labApi.resync(type, 'A'))}>{ro.setAActive}</button><button type="button" disabled={disabled} onClick={() => void action(() => window.labApi.resync(type, 'B'))}>{ro.setBActive}</button><button type="button" disabled={disabled} onClick={() => void action(() => window.labApi.resync(type, 'OFF'))}>{ro.resetLocalOff}</button><button className="stop" type="button" disabled={template.busy} onClick={() => void action(() => window.labApi.stopTemplate(type))}>{ro.stop}</button></div>
          <p className="small muted">{template.confirmation}</p>
        </article>
      })}</div>
    </section>

    <section className="settings-card">
      <div className="settings-card-heading"><div><span className="eyebrow">{ro.eventLogSection}</span><h3>{ro.localEvents}</h3></div><span className="small muted">{snapshot.logs.length} / 200</span></div>
      {snapshot.logPersistenceError && <p className="error" role="alert">Logul nu poate fi scris: {snapshot.logPersistenceError}</p>}
      <div className="event-log" aria-label={ro.log}>{snapshot.logs.length ? snapshot.logs.slice().reverse().map(entry => <div className={`log-entry ${entry.level}`} key={entry.id}>
        <time>{entry.time.slice(11, 23)}</time><span className="log-level">{entry.level.toUpperCase()}</span><div className="log-message"><button type="button" className="log-expand" aria-expanded={expanded === entry.id} onClick={() => setExpanded(current => current === entry.id ? null : entry.id)}>{entry.event}</button>{expanded === entry.id && <pre>{`${ro.logOperationId}: ${String(entry.details.operationId ?? '—')}\n${ro.logTemplate}: ${String(entry.details.template ?? '—')}\n${ro.logStage}: ${String(entry.details.stage ?? '—')}`}</pre>}</div>
      </div>) : <p className="empty-state">{ro.logNoEvents}</p>}</div>
      <p className="small muted">{ro.logPrivacy}</p>
    </section>
  </section>
}
