import { app, type BrowserWindow } from 'electron'
import { loadConfig } from '../../config/loadConfig'
import { registerAppLifecycle, registerSingleInstance } from './bootstrap/appLifecycle'
import './bootstrap/paths'
import { registerMainModuleRegistry } from './bootstrap/registerMainModuleRegistry'
import { createMainWindow } from './bootstrap/createMainWindow'
import { bootstrapAppProtection } from './security/appProtection'
import { applyAppSecurity } from './security/appSecurity'
import path from 'node:path'
import { mkdirSync } from 'node:fs'

if (process.env.OSCON_SMOKE === '1') {
  const settingsRoot = process.env.OSCON_SETTINGS_ROOT
  if (!settingsRoot || !path.isAbsolute(settingsRoot)) throw new Error('Smoke OSCon necesită setări izolate cu o cale absolută.')
  mkdirSync(settingsRoot, { recursive: true })
  app.setPath('userData', settingsRoot)
}

const config = loadConfig()

applyAppSecurity()
bootstrapAppProtection(config)
registerSingleInstance()

let mainWindow: BrowserWindow | null = null

async function bootstrap() {
  await modulesReady
  mainWindow = await createMainWindow()

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

const modulesReady = registerMainModuleRegistry(config, () => mainWindow)
registerAppLifecycle(() => mainWindow, bootstrap)

app.whenReady().then(async () => {
  await modulesReady
  await bootstrap()
})
