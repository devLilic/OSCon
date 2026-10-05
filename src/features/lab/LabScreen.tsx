import { useEffect, useRef, useState } from 'react'
import type { OperatorPage } from '@/app/App'
import type { BridgeInfo } from '@/shared/lab/bridgeContracts'
import { useLab } from './useLab'
import { TemplatePanel } from './TemplatePanel'
import { Diagnostics } from './Diagnostics'
import { SettingsScreen } from './SettingsScreen'
import { ro } from './ro'
import './lab.css'
import './AppShell.css'

const navItems: { id: OperatorPage; label: string; mark: string }[] = [
  { id: 'status', label: ro.navStatus, mark: '01' },
  { id: 'settings', label: ro.navSettings, mark: '02' },
  { id: 'diagnostics', label: ro.navDiagnostics, mark: '03' },
]

export function LabScreen({ page, onPageChange }: { page: OperatorPage; onPageChange: (page: OperatorPage) => void }) {
  const { snapshot, error, action } = useLab()
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [bridge, setBridge] = useState<BridgeInfo | null>(null)
  const pageScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let disposed = false
    void window.labApi.getBridgeInfo().then(info => { if (!disposed) setBridge(info) }).catch(() => undefined)
    return () => { disposed = true }
  }, [page, snapshot?.revision])
  useEffect(() => {
    if (pageScrollRef.current) pageScrollRef.current.scrollTop = 0
  }, [page])
  if (!snapshot) return <main className="lab app-loading"><div className="loading-card"><span className="eyebrow">OSCON / LIVEBOARD</span><h1>{ro.title}</h1><p>{error || ro.loading}</p>{error && <button onClick={() => location.reload()}>{ro.retry}</button>}</div></main>

  const unknownCount = Object.values(snapshot.templates).filter(template => template.state === 'UNKNOWN').length
  const needsResyncCount = Object.values(snapshot.templates).filter(template => template.state === 'NEEDS_RESYNC').length
  const localLabel = unknownCount > 0 ? ro.localNeedsCheck : needsResyncCount > 0 ? ro.localNeedsResync : ro.localReady
  const apiLabel = bridge?.status === 'online' ? ro.apiOnline : bridge?.status === 'error' ? ro.apiError : ro.apiOffline
  const serviceLabel = unknownCount > 0 ? 'needs-check' : needsResyncCount > 0 ? 'needs-resync' : 'local-ready'

  return <main className="lab app-shell">
    <aside className="side-rail">
      <div className="brand-lockup"><span className="brand-glyph">O</span><div><strong>OSCon</strong><span>{ro.brandSubtitle}</span></div></div>
      <div className="rail-label">{ro.operator}</div>
      <nav className="side-nav" aria-label={ro.navLabel}>
        {navItems.map(item => <button type="button" key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => onPageChange(item.id)} aria-current={page === item.id ? 'page' : undefined}>
          <span className="nav-mark">{item.mark}</span><span>{item.label}</span>{item.id === 'status' && <span className={`nav-indicator ${serviceLabel}`} />}
        </button>)}
      </nav>
      <div className="rail-spacer" />
      <button type="button" className="preview-launch" onClick={() => { setPreviewError(null); void window.labApi.openPreview().catch(reason => setPreviewError(reason instanceof Error ? reason.message : String(reason))) }}>
        <span className="preview-launch-icon">▣</span><span><strong>{ro.previewNav}</strong><small>{ro.localPreview}</small></span><span className="external-mark">↗</span>
      </button>
      <div className="rail-version"><span className={`live-dot ${serviceLabel}`} />{localLabel}</div>
    </aside>

    <section className="main-stage">
      <header className="top-bar">
        <div><span className="eyebrow">OSCON / {page === 'status' ? ro.statusEyebrow : page === 'settings' ? ro.settingsEyebrow : ro.diagnosticsEyebrow}</span><h1>{page === 'status' ? ro.statusPageTitle : page === 'settings' ? ro.settingsPageTitle : ro.diagnosticsPageTitle}</h1></div>
        <div className="top-status"><span className={`service-pill ${bridge?.status ?? 'offline'}`}><i />{apiLabel}</span><span className="top-separator" /><div><small>{ro.receiverConfigured}</small><strong>{bridge?.receiver.host ?? snapshot.connection.host}:{bridge?.receiver.port ?? snapshot.connection.port}</strong></div></div>
      </header>

      <div className="page-scroll" ref={pageScrollRef}>
        {(error || previewError) && <p className="error global-error" role="alert">{error || previewError}</p>}
        {page === 'status' && <>
          <div className="operator-intro"><div><h2>{ro.sourcesTitle}</h2><p>{ro.statusDescription}</p></div><span className="unconfirmed-banner"><span />{ro.confirmation}</span></div>
          <div className="operator-grid">
            {(['headline', 'name'] as const).map(type => <TemplatePanel key={type} type={type} items={snapshot.presets.filter(item => item.templateType === type)} state={snapshot.templates[type]} action={action} playLocked={snapshot.templates.name.personExpiresAt !== null} />)}
          </div>
        </>}
        {page === 'settings' && <SettingsScreen snapshot={snapshot} action={action} />}
        {page === 'diagnostics' && <Diagnostics snapshot={snapshot} action={action} />}
      </div>
    </section>
  </main>
}
