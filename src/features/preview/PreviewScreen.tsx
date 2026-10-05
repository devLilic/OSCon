import { useEffect, useState } from 'react'
import type { LabSnapshot } from '@/shared/lab/contracts'
import { selectPreviewGraphic } from './selectPreviewGraphic'
import { ro } from '../lab/ro'
import './preview.css'

export function PreviewScreen() {
  const [snapshot, setSnapshot] = useState<LabSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false
    const accept = (next: LabSnapshot) => setSnapshot(previous => !previous || next.revision >= previous.revision ? next : previous)
    const unsubscribe = window.labApi.onSnapshot(next => { if (!disposed) accept(next) })
    window.labApi.getSnapshot().then(next => { if (!disposed) accept(next) }).catch(e => { if (!disposed) setError(e instanceof Error ? e.message : String(e)) })
    return () => { disposed = true; unsubscribe() }
  }, [])

  const graphic = snapshot ? selectPreviewGraphic(snapshot) : null
  return <main className="preview-root" aria-label={ro.previewNav}>
    <div className="preview-frame" data-testid="preview-frame">
      <div className="studio" />
      <div className="preview-mark">{ro.previewNav.toLocaleUpperCase('ro')} <span>16:9</span></div>
      {graphic && <section className={`lower-third ${graphic.type}`} aria-live="polite" data-testid="active-graphic">
        {graphic.type === 'headline' && graphic.primary && <div className="kicker" data-testid="preview-kicker">{graphic.primary}</div>}
        <div className="title" data-testid="preview-title">{graphic.type === 'headline' ? graphic.secondary : [graphic.primary, graphic.secondary].filter(Boolean).join(' – ')}</div>
      </section>}
      {!snapshot && <div className="preview-loading">{error || ro.previewConnecting}</div>}
      <div className="confirmation">{ro.confirmation} · {ro.previewTextOnly}</div>
    </div>
  </main>
}
