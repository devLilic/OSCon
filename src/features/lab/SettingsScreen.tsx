import { useEffect, useMemo, useState } from 'react'
import type { BridgeInfo, ConnectionSettings } from '@/shared/lab/bridgeContracts'
import type { LabActionResult, LabSettings, LabSnapshot, TemplateType } from '@/shared/lab/contracts'
import { ro } from './ro'

type Action = (call: () => Promise<LabActionResult>) => Promise<LabActionResult | null>
type SettingsApi = {
  getBridgeInfo: () => Promise<BridgeInfo>
  getConnectionSettings: () => Promise<ConnectionSettings>
  setConnectionSettings: (value: ConnectionSettings) => Promise<BridgeInfo>
  revealBridgeToken: () => Promise<string>
  regenerateBridgeToken: () => Promise<string>
}

const settingsApi = () => window.labApi as typeof window.labApi & SettingsApi

const defaultHeadline = (settings: LabSettings): NonNullable<LabSettings['headline']> => settings.headline ?? {
  mode: 'internal-json',
  buffers: {
    A: { contentName: settings.contentNames.headline, kickerPath: '', titlePath: '' },
    B: { contentName: settings.contentNames.headline, kickerPath: '', titlePath: '' },
  },
}

export function SettingsScreen({ snapshot, action }: { snapshot: LabSnapshot; action: Action }) {
  const [labSettings, setLabSettings] = useState<LabSettings>(snapshot.settings)
  const [connection, setConnection] = useState<ConnectionSettings | null>(null)
  const [savedConnection, setSavedConnection] = useState<ConnectionSettings | null>(null)
  const [bridge, setBridge] = useState<BridgeInfo | null>(null)
  const [secret, setSecret] = useState('')
  const [secretVisible, setSecretVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [originsText, setOriginsText] = useState('')

  useEffect(() => {
    let disposed = false
    Promise.all([settingsApi().getConnectionSettings(), settingsApi().getBridgeInfo()])
      .then(([settings, info]) => {
        if (disposed) return
        setConnection(settings)
        setSavedConnection(settings)
        setOriginsText(settings.allowedOrigins.join('\n'))
        setBridge(info)
      })
      .catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { disposed = true; setSecret(''); setSecretVisible(false) }
  }, [])

  const headline = defaultHeadline(labSettings)
  const hasActiveTemplate = (Object.values(snapshot.templates) as LabSnapshot['templates'][TemplateType][])
    .some(template => template.state !== 'OFF' && template.state !== 'UNKNOWN')
  const headlineDirty = JSON.stringify(labSettings) !== JSON.stringify(snapshot.settings)
  const origins = useMemo(() => originsText.split(/\r?\n/).map(value => value.trim()).filter(Boolean), [originsText])
  const connectionDirty = connection !== null && savedConnection !== null && JSON.stringify({ ...connection, allowedOrigins: origins }) !== JSON.stringify(savedConnection)
  const bridgeNeedsVerification = bridge?.status === 'error'
  const anyBusy = (Object.values(snapshot.templates) as LabSnapshot['templates'][TemplateType][]).some(template => template.busy)

  const chooseHeadlineFile = async (buffer: 'A' | 'B', field: 'kickerPath' | 'titlePath') => {
    setError(null)
    try {
      const result = await window.labApi.pickTextFile(headline.buffers[buffer][field] || undefined)
      if (!result.canceled && result.filePath) {
        setLabSettings(current => {
          const next = defaultHeadline(current)
          return { ...current, headline: { ...next, buffers: { ...next.buffers, [buffer]: { ...next.buffers[buffer], [field]: result.filePath! } } } }
        })
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const choosePersonFile = async (field: 'namePath' | 'rolePath') => {
    setError(null)
    try {
      const current = labSettings.personText ?? { namePath: '', rolePath: '' }
      const result = await window.labApi.pickTextFile(current[field] || undefined)
      if (!result.canceled && result.filePath) setLabSettings(value => ({ ...value, personText: { ...(value.personText ?? { namePath: '', rolePath: '' }), [field]: result.filePath! } }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const saveLabSettings = async () => {
    setError(null); setNotice(null)
    setBusy(true)
    try {
      const result = await action(() => window.labApi.setSettings(labSettings))
      if (result?.ok) {
        setLabSettings(result.snapshot.settings)
        setNotice(ro.localSettingsSaved)
        try { setBridge(await settingsApi().getBridgeInfo()) }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
      }
    } finally { setBusy(false) }
  }

  const saveConnection = async () => {
    if (!connection) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const next = { ...connection, allowedOrigins: origins }
      const info = await settingsApi().setConnectionSettings(next)
      setConnection(next); setSavedConnection(next); setBridge(info); setOriginsText(next.allowedOrigins.join('\n'))
      setNotice(ro.connectionSaved)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const showSecret = async (regenerate: boolean) => {
    setBusy(true); setError(null); setNotice(null)
    try {
      const value = regenerate ? await settingsApi().regenerateBridgeToken() : await settingsApi().revealBridgeToken()
      setSecret(value); setSecretVisible(true)
      setNotice(regenerate ? ro.tokenGenerated : ro.tokenRevealed)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setNotice(ro.tokenCopied)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Clipboard indisponibil.')
    }
  }

  const updateHeadline = (patch: Partial<NonNullable<LabSettings['headline']>>) => setLabSettings(current => ({ ...current, headline: { ...defaultHeadline(current), ...patch } }))
  const updateBuffer = (buffer: 'A' | 'B', patch: Partial<NonNullable<LabSettings['headline']>['buffers']['A']>) => setLabSettings(current => {
    const currentHeadline = defaultHeadline(current)
    return { ...current, headline: { ...currentHeadline, buffers: { ...currentHeadline.buffers, [buffer]: { ...currentHeadline.buffers[buffer], ...patch } } } }
  })
  const personText = labSettings.personText ?? { namePath: '', rolePath: '' }
  const updateConnection = (patch: Partial<ConnectionSettings>, requiresConfirmation = false) => setConnection(current => current ? {
    ...current, ...patch, ...(requiresConfirmation ? { setupConfirmed: false } : {}),
  } : current)
  const updateReceiver = (patch: Partial<ConnectionSettings['receiver']>) => setConnection(current => current ? {
    ...current, setupConfirmed: false, receiver: { ...current.receiver, ...patch },
  } : current)

  return <section className="settings-page">
    <div className="page-heading"><div><span className="eyebrow">{ro.settingsOperator}</span><h2>{ro.settingsMainTitle}</h2><p>{ro.settingsIntro}</p></div><span className="settings-save-state">{headlineDirty || connectionDirty ? ro.settingsUnsaved : bridgeNeedsVerification ? ro.settingsNeedsVerification : ro.settingsSaved}</span></div>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success-note" role="status">{notice}</p>}
    <p className="section-description">{ro.connectionFileDevNote}</p>

    <section className="settings-card">
      <div className="settings-card-heading"><div><span className="eyebrow">{ro.liveboardSection}</span><h3>{ro.graphicsSources}</h3></div><button type="button" className="primary-action" disabled={(!headlineDirty && !bridgeNeedsVerification) || hasActiveTemplate || anyBusy || busy} onClick={() => void saveLabSettings()}>{ro.saveSources}</button></div>
      {hasActiveTemplate && <p className="callout" role="status">{ro.stopBeforeConfig}</p>}
      <div className="settings-section">
        <div className="section-intro"><strong>{ro.headlineAB}</strong><span>{ro.headlineHint}</span></div>
        <label className="form-field compact-field">{ro.source}<select disabled={hasActiveTemplate} value={headline.mode} onChange={event => updateHeadline({ mode: event.target.value as typeof headline.mode })}><option value="external-txt">{ro.externalTxtSource}</option><option value="internal-json">{ro.internalJsonSource}</option></select></label>
        {headline.mode === 'external-txt' ? <div className="buffer-settings-grid">{(['A', 'B'] as const).map(buffer => <div className="buffer-settings" key={buffer}><div className="buffer-heading"><span>{ro.buffer} {buffer}</span><small>{snapshot.templates.headline.activeBuffer === buffer ? ro.activeBufferTag : snapshot.templates.headline.hiddenBuffer === buffer ? ro.hiddenBufferTag : ro.neutralBuffer}</small></div>
          <label className="form-field">{ro.liveBoardExactName}<input disabled={hasActiveTemplate} maxLength={100} value={headline.buffers[buffer].contentName} onChange={event => updateBuffer(buffer, { contentName: event.target.value })} /></label>
          {(['kickerPath', 'titlePath'] as const).map((field, index) => <label className="form-field" key={field}>{index === 0 ? ro.kickerTxtFile : ro.titleTxtFile}<span className="file-row"><input disabled={hasActiveTemplate} value={headline.buffers[buffer][field]} onChange={event => updateBuffer(buffer, { [field]: event.target.value })} /><button type="button" disabled={hasActiveTemplate} onClick={() => void chooseHeadlineFile(buffer, field)}>{ro.choose}</button></span></label>)}
        </div>)}</div> : <div className="json-source-settings"><label className="form-field compact-field">{ro.jsonContent}<input disabled={hasActiveTemplate} maxLength={100} value={labSettings.contentNames.headline} onChange={event => setLabSettings(current => ({ ...current, contentNames: { ...current.contentNames, headline: event.target.value } }))} /></label><div className="source-readout"><span>{ro.internalJsonSource}</span><strong>{snapshot.settings.contentNames.headline}</strong><small>{snapshot.jsonPaths.headline}</small></div></div>}
      </div>
      <div className="settings-section">
        <div className="section-intro"><strong>{ro.personTxt}</strong><span>{ro.personTxtHint}</span></div>
        <label className="form-field compact-field">{ro.personLiveBoardName}<input disabled={hasActiveTemplate} maxLength={100} value={labSettings.contentNames.name} onChange={event => setLabSettings(current => ({ ...current, contentNames: { ...current.contentNames, name: event.target.value } }))} /></label>
        <div className="buffer-settings-grid person-settings">{(['namePath', 'rolePath'] as const).map((field, index) => <label className="form-field" key={field}>{index === 0 ? ro.personNameTxt : ro.personRoleTxt}<span className="file-row"><input disabled={hasActiveTemplate} value={personText[field]} onChange={event => setLabSettings(current => ({ ...current, personText: { ...(current.personText ?? { namePath: '', rolePath: '' }), [field]: event.target.value } }))} /><button type="button" disabled={hasActiveTemplate} onClick={() => void choosePersonFile(field)}>{ro.choose}</button></span></label>)}</div>
        <div className="timing-grid"><label className="form-field">{ro.filePropagation}<select disabled={hasActiveTemplate} value={labSettings.jsonDelayMs} onChange={event => setLabSettings(current => ({ ...current, jsonDelayMs: Number(event.target.value) as LabSettings['jsonDelayMs'] }))}>{[100, 250, 500, 1000].map(value => <option value={value} key={value}>{value} ms</option>)}</select></label><label className="form-field">{ro.headlineGap}<select disabled={hasActiveTemplate} value={labSettings.headlineTransitionGapMs} onChange={event => setLabSettings(current => ({ ...current, headlineTransitionGapMs: Number(event.target.value) as LabSettings['headlineTransitionGapMs'] }))}>{[0, 50, 100, 150, 200, 250, 500, 1000].map(value => <option value={value} key={value}>{value} ms</option>)}</select></label><label className="form-field">{ro.durationPerson}<input type="number" min={1000} max={60000} step={500} disabled={hasActiveTemplate} value={labSettings.personDurationMs} onChange={event => setLabSettings(current => ({ ...current, personDurationMs: Number(event.target.value) }))} /></label></div>
        <div className="source-readout"><span>{ro.jsonPerson}</span><strong>{snapshot.settings.contentNames.name}</strong><small>{snapshot.jsonPaths.name}</small></div>
      </div>
    </section>

    <section className="settings-card">
      <div className="settings-card-heading"><div><span className="eyebrow">{ro.plasmaSection}</span><h3>{ro.plasmaConnection}</h3></div><span className={`connection-state ${bridge?.status ?? 'offline'}`}><i />{bridge?.status ?? 'offline'}</span></div>
      <p className="section-description">{ro.plasmaBridgeDescription}</p>
      {!connection ? <p className="muted">{ro.readingConnection}</p> : <>
        <div className="connection-settings-grid">
          <label className="form-field check-field"><input type="checkbox" checked={connection.enabled} disabled={hasActiveTemplate || busy} onChange={event => setConnection({ ...connection, enabled: event.target.checked })} /> {ro.enablePlasma}</label>
          <label className="form-field">{ro.bindAddress}<input disabled={hasActiveTemplate || busy} value={connection.bindAddress} onChange={event => updateConnection({ bindAddress: event.target.value }, true)} /></label>
          <label className="form-field">{ro.httpPort}<input type="number" min={1} max={65535} disabled={hasActiveTemplate || busy} value={connection.port} onChange={event => updateConnection({ port: Number(event.target.value) }, true)} /></label>
          <label className="form-field span-two">{ro.allowedOrigins}<textarea rows={3} spellCheck={false} disabled={hasActiveTemplate || busy} value={originsText} onChange={event => { setOriginsText(event.target.value); updateConnection({}, true) }} /><small>{ro.oneOriginPerLine}</small></label>
        </div>
        <div className="receiver-settings"><div className="section-intro"><strong>{ro.receiverTitle}</strong><span>{ro.receiverHint}</span></div><div className="receiver-grid"><label className="form-field">{ro.host}<input disabled={hasActiveTemplate || busy} value={connection.receiver.host} onChange={event => updateReceiver({ host: event.target.value })} /></label><label className="form-field">{ro.udpPort}<input type="number" min={1} max={65535} disabled={hasActiveTemplate || busy} value={connection.receiver.port} onChange={event => updateReceiver({ port: Number(event.target.value) })} /></label><label className="form-field">{ro.oscPrefix}<input disabled={hasActiveTemplate || busy} value={connection.receiver.addressPrefix} onChange={event => updateReceiver({ addressPrefix: event.target.value })} /></label></div></div>
        <label className="form-field check-field setup-confirmation"><input type="checkbox" checked={connection.setupConfirmed} disabled={hasActiveTemplate || busy} onChange={event => setConnection({ ...connection, setupConfirmed: event.target.checked })} /> {ro.confirmConnectionSetup}</label>
        <div className="connection-footer"><span className="small muted">{bridge?.endpoint || ro.apiDisabled} · {connection.setupConfirmed ? ro.setupConfirmed : ro.setupUnverified}</span><button type="button" className="primary-action" disabled={(!connectionDirty && !bridgeNeedsVerification) || hasActiveTemplate || anyBusy || busy} onClick={() => void saveConnection()}>{ro.saveConnection}</button></div>
        {bridge?.error && <p className="error" role="alert">{bridge.error}</p>}
        <div className="secret-tools"><div><strong>{ro.bearerToken}</strong><p>{ro.tokenPrivacy}</p></div><button type="button" disabled={busy} onClick={() => void showSecret(false)}>{ro.revealToken}</button><button type="button" className="secondary-action" disabled={busy || hasActiveTemplate || anyBusy} onClick={() => void showSecret(true)}>{ro.generateNewToken}</button></div>
        {secretVisible && secret && <div className="revealed-secret"><label className="form-field">{ro.tokenForPlasma}<input type="text" readOnly spellCheck={false} value={secret} onFocus={event => event.currentTarget.select()} /></label><button type="button" onClick={() => void copySecret()}>{ro.copy}</button><button type="button" onClick={() => { setSecret(''); setSecretVisible(false) }}>{ro.hide}</button></div>}
      </>}
    </section>
  </section>
}
