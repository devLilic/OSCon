export interface ConnectionSettings {
  schemaVersion: 1
  setupConfirmed: boolean
  enabled: boolean
  bindAddress: string
  port: number
  allowedOrigins: string[]
  receiver: { host: string; port: number; addressPrefix: string }
}

/** Local operator API. Secrets are requested separately and never included here. */
export interface BridgeInfo {
  endpoint: string
  allowedOrigins: string[]
  status: 'online' | 'offline' | 'error'
  error: string | null
  receiver: ConnectionSettings['receiver']
  setupConfirmed: boolean
}
