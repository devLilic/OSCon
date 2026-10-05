import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_BRIDGE_SETTINGS, BridgeSettingsService, type BridgeSettings, validateConnectionSettings } from './BridgeSettingsService'
import { ControllerHttpBridge } from './ControllerHttpBridge'
import { defaultExternalTxtSettings, LAB_PRESETS } from '../../../../config/lab'
import type { BridgeInfo, ConnectionSettings } from '../../../../src/shared/lab/bridgeContracts'
import { labChannels, type LabActionResult, type LabSnapshot } from '../../../../src/shared/lab/contracts'
import { objectPayload, templateType, validateSettings } from '../../../../src/shared/lab/validation'
import type { MainModule } from '../../../../src/shared/modules/contracts'
import { createLogger } from '../../logging'
import { previewHtmlPath, indexHtmlPath, VITE_DEV_SERVER_URL } from '../../bootstrap/paths'
import { applyRuntimeSecurityPolicies } from '../../security/runtimeSecurity'
import { createSecureBrowserWindow } from '../../security/windowFactory'
import { DelayBarrier } from './DelayBarrier'
import { DevelopmentDefaultsService } from './DevelopmentDefaultsService'
import { EventLog } from './EventLog'
import { GraphicsController } from './GraphicsController'
import { HeadlineTextDataSourceService } from './HeadlineTextDataSourceService'
import { JsonDataSourceService } from './JsonDataSourceService'
import { LabSettingsService } from './LabSettingsService'
import { LiveBoardOscService } from './LiveBoardOscService'
import { labDataDirectory } from './dataPaths'

const safeSettingsError = 'Setările locale sunt corupte sau incompatibile. Salvează setări valide pentru a continua.'
const safeBridgeError = 'Setările conexiunii sunt corupte sau incompatibile. Serviciul HTTP rămâne oprit.'

export async function loadPlaybackStartupSettings(
  service: LabSettingsService,
  fallback: import('../../../../src/shared/lab/contracts').LabSettings,
  defaultsError: string | null,
): Promise<{ settings: import('../../../../src/shared/lab/contracts').LabSettings; error: string | null; loadFailed: boolean }> {
  try {
    const loaded = await service.load(fallback)
    if (loaded.isNew) {
      if (defaultsError) return { settings: loaded.settings, error: defaultsError, loadFailed: false }
      await service.save(loaded.settings)
    } else if (loaded.migrated) {
      await service.save(loaded.settings)
    }
    return { settings: loaded.settings, error: null, loadFailed: false }
  } catch {
    return { settings: fallback, error: safeSettingsError, loadFailed: true }
  }
}

export async function rollbackBeforeRelease(rollback: () => Promise<void>, release: () => void): Promise<void> {
  try { await rollback() }
  finally { release() }
}

function validateSender(event: IpcMainInvokeEvent, allowed: 'main' | 'preview' | 'either' = 'main') {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) throw new Error('IPC LAB refuzat: frame invalid.')
  const matches = (filePath: string, devPath: string) => {
    try {
      const actual = new URL(frame.url)
      actual.hash = ''
      actual.search = ''
      if (VITE_DEV_SERVER_URL) {
        const configured = new URL(VITE_DEV_SERVER_URL)
        const route = new URL(devPath, configured)
        return actual.origin === route.origin && actual.pathname.replace(/\/$/, '') === route.pathname.replace(/\/$/, '')
      }
      return actual.href === pathToFileURL(filePath).href
    } catch { return false }
  }
  const main = matches(indexHtmlPath, '/')
  const preview = matches(previewHtmlPath, '/preview.html')
  if (!(allowed === 'either' ? main || preview : allowed === 'main' ? main : preview)) {
    throw new Error('IPC LAB refuzat: sursă necunoscută.')
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function createLabMainModule(): MainModule {
  return {
    id: 'liveboard-lab',
    async register({ config }) {
      const userData = app.getPath('userData')
      const settingsRoot = process.env.OSCON_SETTINGS_ROOT || userData
      const dataDirectory = labDataDirectory({ userData, override: process.env.OSCON_DATA_ROOT })
      await mkdir(settingsRoot, { recursive: true })
      await mkdir(dataDirectory, { recursive: true })

      const defaultsDirectory = app.isPackaged
        ? path.join(process.resourcesPath, 'defaults')
        : path.join(app.getAppPath(), 'config', 'defaults')
      const defaults = new DevelopmentDefaultsService(defaultsDirectory)
      const generatedPlayback = defaultExternalTxtSettings(dataDirectory)
      let playbackDefaults = generatedPlayback
      let connectionDefaults: ConnectionSettings = DEFAULT_BRIDGE_SETTINGS
      let playbackDefaultsError: string | null = null
      let connectionDefaultsError: string | null = null
      try { playbackDefaults = await defaults.loadPlayback(generatedPlayback, dataDirectory) }
      catch { playbackDefaultsError = 'Configurația implicită Playback este invalidă.' }
      try { connectionDefaults = await defaults.loadConnection(DEFAULT_BRIDGE_SETTINGS) }
      catch { connectionDefaultsError = 'Configurația implicită de conectare este invalidă.' }

      const playbackSettingsService = new LabSettingsService(path.join(settingsRoot, 'lab-settings.json'))
      const bridgeSettingsService = new BridgeSettingsService(settingsRoot, connectionDefaults)
      const logDirectory = path.join(settingsRoot, 'logs')
      const log = new EventLog(logDirectory, createLogger(config, 'lab'))
      const json = new JsonDataSourceService(dataDirectory, log)
      await json.initialize()

      const playbackStartup = await loadPlaybackStartupSettings(playbackSettingsService, playbackDefaults, playbackDefaultsError)
      let playbackSettings = playbackStartup.settings
      const playbackLoadError = playbackStartup.error
      if (playbackStartup.loadFailed) log.write('error', 'PLAYBACK_SETTINGS_LOAD_FAILED', { error: safeSettingsError })

      const text = new HeadlineTextDataSourceService(log)
      const defaultTextPaths = defaultExternalTxtSettings(dataDirectory)
      const textBuffers = defaultTextPaths.headline!.buffers
      const textPaths = [textBuffers.A.kickerPath, textBuffers.A.titlePath, textBuffers.B.kickerPath, textBuffers.B.titlePath,
        defaultTextPaths.personText!.namePath, defaultTextPaths.personText!.rolePath]
      // Only managed demo files are created at startup. Castalia paths are touched on an explicit PLAY.
      await text.initialize(textPaths)

      const osc = new LiveBoardOscService(log, DEFAULT_BRIDGE_SETTINGS.receiver)
      let revision = 0
      let controller!: GraphicsController
      let connectionSettings: BridgeSettings | null = null
      let bridge: ControllerHttpBridge | null = null
      let playbackConfigError = playbackLoadError
      let connectionConfigError: string | null = null
      let bridgeError: string | null = null
      let previewWindow: BrowserWindow | null = null

      const snapshot = (): LabSnapshot => ({
        revision,
        activationOrder: controller.getActivationOrder(),
        templates: controller.getTemplates(),
        presets: controller.getPresets(),
        settings: controller.getSettings(),
        connection: {
          host: connectionSettings?.receiver.host ?? connectionDefaults.receiver.host,
          port: connectionSettings?.receiver.port ?? connectionDefaults.receiver.port,
          baseAddress: connectionSettings?.receiver.addressPrefix ?? connectionDefaults.receiver.addressPrefix,
          liveBoardSenderHost: 'localhost:601',
        },
        jsonPaths: json.paths,
        logPath: log.filePath,
        logPersistenceError: log.persistenceError,
        logs: log.getEntries(),
      })
      const publish = () => {
        revision++
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(labChannels.changed, snapshot())
        }
      }

      controller = new GraphicsController(json, osc, new DelayBarrier(log), log, LAB_PRESETS, playbackSettings, publish, text, text)
      const reconfigureBridge = async () => {
        await bridge?.close()
        bridge = null
        bridgeError = null
        if (!connectionSettings || playbackConfigError || connectionConfigError) return
        bridge = new ControllerHttpBridge({ controller, settings: connectionSettings, configPath: bridgeSettingsService.filePath })
        await bridge.start()
        if (bridge.getInfo().status === 'error') bridgeError = bridge.getInfo().error
      }

      try {
        connectionSettings = await bridgeSettingsService.load({ allowCreate: !connectionDefaultsError })
        osc.updateConnection(connectionSettings.receiver)
        if (connectionDefaultsError) log.write('warn', 'CONNECTION_DEFAULTS_INVALID', { error: 'Valid local connection settings take precedence over invalid bundled defaults.' })
      } catch {
        connectionConfigError = safeBridgeError
        connectionSettings = { ...connectionDefaults, token: randomBytes(32).toString('hex') }
        osc.updateConnection(connectionSettings.receiver)
        log.write('error', 'CONNECTION_SETTINGS_LOAD_FAILED', { error: safeBridgeError })
      }
      if (!connectionConfigError && !playbackConfigError) {
        try { await reconfigureBridge() }
        catch {
          bridgeError = 'Serviciul HTTP nu poate porni pe configurația curentă.'
          log.write('error', 'BRIDGE_START_FAILED', { error: bridgeError })
        }
      }

      const getBridgeInfo = (): BridgeInfo => {
        const info = bridge?.getInfo() ?? {
          endpoint: `http://${connectionSettings?.bindAddress ?? connectionDefaults.bindAddress}:${connectionSettings?.port ?? connectionDefaults.port}`,
          allowedOrigins: [...(connectionSettings?.allowedOrigins ?? connectionDefaults.allowedOrigins)],
          status: connectionSettings?.enabled ? 'error' as const : 'offline' as const,
          error: null,
          receiver: { ...(connectionSettings?.receiver ?? connectionDefaults.receiver) },
          setupConfirmed: connectionSettings?.setupConfirmed ?? connectionDefaults.setupConfirmed,
        }
        const error = playbackConfigError ?? connectionConfigError ?? bridgeError ?? info.error
        return error ? { ...info, status: 'error', error } : info
      }

      const openPreview = async () => {
        const smokeMode = process.env.OSCON_SMOKE === '1'
        if (previewWindow && !previewWindow.isDestroyed()) {
          if (!smokeMode) {
            if (previewWindow.isMinimized()) previewWindow.restore()
            previewWindow.show()
            previewWindow.focus()
          }
          return
        }
        const window = createSecureBrowserWindow({
          title: 'OSCon · Preview', width: 1280, height: 760, minWidth: 640, minHeight: 400,
          backgroundColor: '#101722', show: false,
        })
        previewWindow = window
        window.on('closed', () => { if (previewWindow === window) previewWindow = null })
        applyRuntimeSecurityPolicies(window)
        if (VITE_DEV_SERVER_URL) await window.loadURL(new URL('preview.html', VITE_DEV_SERVER_URL).href)
        else await window.loadFile(previewHtmlPath)
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(labChannels.changed, snapshot())
        if (!smokeMode) {
          window.show()
          window.focus()
        }
      }

      log.onChange = publish
      const handle = (channel: string, action: (payload: unknown) => Promise<void> | void, requiresPlaybackSettings = true) => {
        ipcMain.handle(channel, async (event, payload: unknown): Promise<LabActionResult> => {
          validateSender(event)
          try {
            const configurationError = playbackConfigError ?? connectionConfigError
            if (requiresPlaybackSettings && configurationError) throw new Error(configurationError)
            await action(payload)
            return { ok: true, snapshot: snapshot() }
          } catch (error) {
            const message = getErrorMessage(error)
            const configurationError = playbackConfigError ?? connectionConfigError
            log.write('error', 'ACTION_REJECTED', { channel, error: configurationError ?? message })
            return { ok: false, error: configurationError ?? message, snapshot: snapshot() }
          }
        })
      }

      ipcMain.handle(labChannels.snapshot, event => { validateSender(event, 'either'); return snapshot() })
      ipcMain.handle(labChannels.bridgeInfo, event => { validateSender(event); return getBridgeInfo() })
      ipcMain.handle(labChannels.connectionSettings, event => {
        validateSender(event)
        const { token: _secret, ...safe } = connectionSettings ?? { ...connectionDefaults, token: '' }
        return structuredClone(safe)
      })
      ipcMain.handle(labChannels.revealBridgeToken, async event => {
        validateSender(event)
        if (connectionConfigError) throw new Error(safeBridgeError)
        connectionSettings = await bridgeSettingsService.load()
        return connectionSettings.token
      })
      ipcMain.handle(labChannels.regenerateBridgeToken, async event => {
        validateSender(event)
        if (connectionConfigError) throw new Error(safeBridgeError)
        controller.reserveConnectionSettingsUpdate()
        let reservationFinished = false
        const current = connectionSettings ?? { ...connectionDefaults, token: randomBytes(32).toString('hex') }
        const next = { ...current, token: randomBytes(32).toString('hex') }
        let localWritten = false
        try {
          await bridgeSettingsService.save(next)
          localWritten = true
          connectionSettings = next
          connectionConfigError = null
          await reconfigureBridge()
          controller.commitConnectionSettingsUpdate()
          reservationFinished = true
          publish()
          return next.token
        } catch (error) {
          await rollbackBeforeRelease(async () => {
            if (localWritten) await bridgeSettingsService.save(current).catch(() => {})
            connectionSettings = current
            await reconfigureBridge().catch(() => { bridgeError = 'Serviciul HTTP nu poate reporni pe setările precedente.' })
          }, () => { controller.cancelConnectionSettingsUpdate(); reservationFinished = true })
          throw error
        } finally {
          if (!reservationFinished) controller.cancelConnectionSettingsUpdate()
        }
      })
      ipcMain.handle(labChannels.setConnectionSettings, async (event, payload: unknown) => {
        validateSender(event)
        const nextConnection = validateConnectionSettings(payload)
        controller.reserveConnectionSettingsUpdate()
        const previous = connectionSettings
        const previousConnectionConfigError = connectionConfigError
        const next: BridgeSettings = { ...nextConnection, token: previous?.token ?? randomBytes(32).toString('hex') }
        const { token: _secret, ...safeSettings } = next
        let defaultsWritten = false
        let localWritten = false
        let reservationFinished = false
        try {
          if (!app.isPackaged && process.env.OSCON_SMOKE !== '1') {
            await defaults.saveConnection(safeSettings)
            defaultsWritten = true
          }
          await bridgeSettingsService.save(next)
          localWritten = true
          await bridge?.close()
          bridge = null
          const receiverChanged = JSON.stringify(previous?.receiver ?? connectionDefaults.receiver) !== JSON.stringify(next.receiver)
          connectionSettings = next
          connectionConfigError = null
          osc.updateConnection(next.receiver)
          if (receiverChanged) controller.invalidateConnectionState()
          await reconfigureBridge()
          controller.commitConnectionSettingsUpdate()
          reservationFinished = true
          publish()
          return getBridgeInfo()
        } catch (error) {
          if (!previous && localWritten) {
            // A valid replacement repairs a corrupt/missing local connection file. Keep
            // that replacement coherent if a later runtime step fails, and expose the
            // bridge error through the normal status snapshot.
            connectionSettings = next
            connectionConfigError = null
            osc.updateConnection(next.receiver)
            bridgeError = 'Setările au fost salvate, dar serviciul HTTP nu a putut fi actualizat.'
            await reconfigureBridge().catch(() => { bridgeError = 'Setările au fost salvate; serviciul HTTP rămâne indisponibil.' })
            controller.commitConnectionSettingsUpdate()
            reservationFinished = true
            publish()
            return getBridgeInfo()
          }
          await rollbackBeforeRelease(async () => {
            if (localWritten && previous) await bridgeSettingsService.save(previous).catch(() => {})
            if (defaultsWritten) {
              const { token: _previousToken, ...previousSafe } = previous ?? { ...connectionDefaults, token: '' }
              await defaults.saveConnection(previousSafe).catch(() => {})
            }
            if (previous) {
              connectionSettings = previous
              connectionConfigError = previousConnectionConfigError
              osc.updateConnection(previous.receiver)
              await reconfigureBridge().catch(() => { bridgeError = 'Serviciul HTTP nu poate reporni pe setările precedente.' })
            }
          }, () => { controller.cancelConnectionSettingsUpdate(); reservationFinished = true })
          throw error
        } finally {
          if (!reservationFinished) controller.cancelConnectionSettingsUpdate()
        }
      })
      ipcMain.handle(labChannels.openPreview, async event => { validateSender(event); await openPreview() })
      handle(labChannels.play, payload => {
        const input = objectPayload(payload)
        if (typeof input.itemId !== 'string' || input.itemId.length > 100) throw new Error('Item ID invalid.')
        return controller.playItem(input.itemId, input.fields as Parameters<GraphicsController['playItem']>[1])
      })
      handle(labChannels.stop, payload => controller.stopTemplate(templateType(objectPayload(payload).template)))
      handle(labChannels.settings, async payload => {
        const next = controller.reserveSettingsUpdate(payload as Parameters<GraphicsController['updateSettings']>[0])
        const previous = playbackSettings
        const previousConfigError = playbackConfigError
        const previousDefaultsError = playbackDefaultsError
        let defaultsWritten = false
        let localWritten = false
        let reservationFinished = false
        try {
          if (!app.isPackaged && process.env.OSCON_SMOKE !== '1') {
            await defaults.savePlayback(next, dataDirectory)
            defaultsWritten = true
          }
          await playbackSettingsService.save(next)
          localWritten = true
          playbackSettings = next
          playbackConfigError = null
          playbackDefaultsError = null
          await reconfigureBridge()
          controller.commitSettingsUpdate(next)
          reservationFinished = true
        } catch (error) {
          await rollbackBeforeRelease(async () => {
            if (localWritten) await playbackSettingsService.save(previous).catch(() => {})
            playbackSettings = previous
            playbackConfigError = previousConfigError
            playbackDefaultsError = previousDefaultsError
            if (defaultsWritten) await defaults.savePlayback(previous, dataDirectory).catch(() => {})
            await reconfigureBridge().catch(() => { bridgeError = 'Serviciul HTTP nu poate reporni după restaurarea setărilor.' })
          }, () => { controller.cancelSettingsUpdate(); reservationFinished = true })
          throw error
        } finally {
          if (!reservationFinished) controller.cancelSettingsUpdate()
        }
      }, false)
      ipcMain.handle(labChannels.pickTextFile, async (event, payload: unknown) => {
        validateSender(event)
        const request = objectPayload(payload)
        const currentPath = request.currentPath
        if (currentPath !== undefined && (typeof currentPath !== 'string' || currentPath.length > 2000)) throw new Error('Calea curentă invalidă.')
        const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        const result = await dialog.showOpenDialog(window, {
          title: 'Alege fișierul TXT',
          properties: ['openFile'],
          filters: [{ name: 'Fișiere text', extensions: ['txt'] }],
          ...(currentPath ? { defaultPath: path.dirname(currentPath as string) } : {}),
        })
        return { canceled: result.canceled, filePath: result.canceled ? null : result.filePaths[0] ?? null }
      })
      handle(labChannels.resync, payload => {
        const input = objectPayload(payload)
        if (input.active !== 'A' && input.active !== 'B' && input.active !== 'OFF') throw new Error('Resync invalid.')
        controller.resync(templateType(input.template), input.active)
      }, false)

      app.once('before-quit', () => {
        void bridge?.close()
        controller.dispose()
        if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close()
        osc.close()
      })
      log.write('warn', 'LAB_READY', { confirmation: 'LOCAL/UNCONFIRMED' })
    },
  }
}
