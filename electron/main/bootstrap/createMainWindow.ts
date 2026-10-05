import { indexHtmlPath, VITE_DEV_SERVER_URL } from './paths'
import { applyRuntimeSecurityPolicies } from '../security/runtimeSecurity'
import { createSecureBrowserWindow } from '../security/windowFactory'
import { ipcEventChannels } from '../../../src/shared/ipc/contracts'

export async function createMainWindow() {
  const window = createSecureBrowserWindow({
    title: 'OSCon',
    width: 1280, height: 900, minWidth: 960, minHeight: 640,
    backgroundColor: '#0a1018',
    show: process.env.OSCON_SMOKE !== '1',
  })

  if (VITE_DEV_SERVER_URL) {
    await window.loadURL(VITE_DEV_SERVER_URL)
    if (process.env.OSCON_SMOKE !== '1') window.webContents.openDevTools()
  } else {
    await window.loadFile(indexHtmlPath)
  }

  window.webContents.on('did-finish-load', () => {
    window.webContents.send(ipcEventChannels.appMainProcessMessage, new Date().toLocaleString())
  })

  applyRuntimeSecurityPolicies(window)

  return window
}
