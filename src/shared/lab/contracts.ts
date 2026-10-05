export type TemplateType = 'headline' | 'name'
export type BufferId = 'A' | 'B'
export type HeadlineMode = 'external-txt' | 'internal-json'
export interface HeadlineBufferConfig {
  contentName: string
  kickerPath: string
  titlePath: string
}
export interface HeadlineSettings {
  mode: HeadlineMode
  buffers: Record<BufferId, HeadlineBufferConfig>
}
export interface PersonTextSettings { namePath: string; rolePath: string }
export type TemplateState = 'UNKNOWN' | 'OFF' | 'ON_A' | 'SWAPPING_A_B' | 'ON_B' | 'SWAPPING_B_A' | 'NEEDS_RESYNC' | 'SUSPENDED_FOR_PERSON'
export type JsonDelay = 100 | 250 | 500 | 1000
export type HeadlineTransitionGapMs = 0 | 50 | 100 | 150 | 200 | 250 | 500 | 1000
export type PlaybackCommand = 'play' | 'stop' | 'resume'
export interface GraphicFields { primary: string; secondary: string }
export interface GraphicItem {
  id: string
  templateType: TemplateType
  label: string
  fields: GraphicFields
}
export interface LabSettings {
  jsonDelayMs: JsonDelay
  personDurationMs: number
  /** Optional only for legacy/internal-JSON settings; new LAB defaults use TXT files. */
  personText?: PersonTextSettings
  /** Gap between RESUME old and PLAY new during an external TXT Headline swap. */
  headlineTransitionGapMs: HeadlineTransitionGapMs
  contentNames: Record<TemplateType, string>
  /** Missing only in legacy saved settings; interpret it as internal-json. */
  headline?: HeadlineSettings
}
export interface TemplateSnapshot {
  state: TemplateState
  busy: boolean
  personExpiresAt: number | null
  activeItemId: string | null
  activeBuffer: BufferId | null
  hiddenBuffer: BufferId | null
  bufferItems: Record<BufferId, string | null>
  bufferFields: Record<BufferId, GraphicFields | null>
  lastError: string | null
  confirmation: 'LOCAL/UNCONFIRMED'
}
export interface LabLogEntry {
  id: number
  time: string
  level: 'info' | 'warn' | 'error'
  event: string
  details: Record<string, unknown>
}
export interface LabSnapshot {
  revision: number
  /** Template playback recency, oldest to newest; stopped templates are omitted. */
  activationOrder: TemplateType[]
  templates: Record<TemplateType, TemplateSnapshot>
  presets: GraphicItem[]
  settings: LabSettings
  connection: { host: string; port: number; baseAddress: string; liveBoardSenderHost: string }
  jsonPaths: Record<TemplateType, string>
  logPath: string
  logPersistenceError: string | null
  logs: LabLogEntry[]
}
export interface FilePickResult {
  canceled: boolean
  filePath: string | null
}
export type LabActionResult = { ok: true; snapshot: LabSnapshot } | { ok: false; error: string; snapshot: LabSnapshot }
export interface LabApi {
  getBridgeInfo(): Promise<import('./bridgeContracts').BridgeInfo>
  getConnectionSettings(): Promise<import('./bridgeContracts').ConnectionSettings>
  setConnectionSettings(value: import('./bridgeContracts').ConnectionSettings): Promise<import('./bridgeContracts').BridgeInfo>
  revealBridgeToken(): Promise<string>
  regenerateBridgeToken(): Promise<string>
  openPreview(): Promise<void>
  getSnapshot(): Promise<LabSnapshot>
  playItem(itemId: string, fields?: Partial<GraphicFields>): Promise<LabActionResult>
  stopTemplate(template: TemplateType): Promise<LabActionResult>
  setSettings(settings: LabSettings): Promise<LabActionResult>
  resync(template: TemplateType, active: BufferId | 'OFF'): Promise<LabActionResult>
  pickTextFile(currentPath?: string): Promise<FilePickResult>
  onSnapshot(listener: (snapshot: LabSnapshot) => void): () => void
}
export const labChannels = {
  bridgeInfo: 'lab:bridge-info',
  connectionSettings: 'lab:connection-settings',
  setConnectionSettings: 'lab:set-connection-settings',
  revealBridgeToken: 'lab:reveal-bridge-token',
  regenerateBridgeToken: 'lab:regenerate-bridge-token',
  snapshot: 'lab:snapshot', openPreview: 'lab:open-preview', play: 'lab:play', stop: 'lab:stop', settings: 'lab:settings', resync: 'lab:resync', pickTextFile: 'lab:pick-text-file', changed: 'lab:changed',
} as const
export interface LabInvokeContract {
  [labChannels.bridgeInfo]: { request: void; response: import('./bridgeContracts').BridgeInfo }
  [labChannels.connectionSettings]: { request: void; response: import('./bridgeContracts').ConnectionSettings }
  [labChannels.setConnectionSettings]: { request: import('./bridgeContracts').ConnectionSettings; response: import('./bridgeContracts').BridgeInfo }
  [labChannels.revealBridgeToken]: { request: void; response: string }
  [labChannels.regenerateBridgeToken]: { request: void; response: string }
  [labChannels.openPreview]: { request: void; response: void }
  [labChannels.snapshot]: { request: void; response: LabSnapshot }
  [labChannels.play]: { request: { itemId: string; fields?: Partial<GraphicFields> }; response: LabActionResult }
  [labChannels.stop]: { request: { template: TemplateType }; response: LabActionResult }
  [labChannels.settings]: { request: LabSettings; response: LabActionResult }
  [labChannels.resync]: { request: { template: TemplateType; active: BufferId | 'OFF' }; response: LabActionResult }
  [labChannels.pickTextFile]: { request: { currentPath?: string }; response: FilePickResult }
}
