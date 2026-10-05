import { contextBridge } from 'electron'
import { labChannels, type LabApi } from '../../../src/shared/lab/contracts'
import type { PreloadModule } from '../../../src/shared/modules/contracts'
import { invoke, subscribe } from './shared'

export function createLabApiPreloadModule(): PreloadModule {
  return {
    id: 'lab-api',
    register() {
      const api: LabApi = {
        getBridgeInfo: () => invoke(labChannels.bridgeInfo),
        getConnectionSettings: () => invoke(labChannels.connectionSettings),
        setConnectionSettings: settings => invoke(labChannels.setConnectionSettings, settings),
        revealBridgeToken: () => invoke(labChannels.revealBridgeToken),
        regenerateBridgeToken: () => invoke(labChannels.regenerateBridgeToken),
        openPreview: () => invoke(labChannels.openPreview),
        getSnapshot: () => invoke(labChannels.snapshot),
        playItem: (itemId, fields) => invoke(labChannels.play, { itemId, fields }),
        stopTemplate: template => invoke(labChannels.stop, { template }),
        setSettings: settings => invoke(labChannels.settings, settings),
        resync: (template, active) => invoke(labChannels.resync, { template, active }),
        pickTextFile: currentPath => invoke(labChannels.pickTextFile, { currentPath }),
        onSnapshot: listener => subscribe(labChannels.changed, listener),
      }
      contextBridge.exposeInMainWorld('labApi', api)
    },
  }
}
