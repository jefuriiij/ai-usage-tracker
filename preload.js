'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, locked-down bridge for the popup renderer.
contextBridge.exposeInMainWorld('api', {
  /** Subscribe to usage pushes from main. Returns an unsubscribe fn. */
  onUsage(callback) {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('usage', handler);
    return () => ipcRenderer.removeListener('usage', handler);
  },
  /** Ask main to poll now (throttled there). Resolves with the latest payload. */
  refresh: () => ipcRenderer.invoke('refresh'),
  /** Open a provider's usage page in the default browser, by provider id. */
  openConsole: (id) => ipcRenderer.send('open-console', String(id)),
  quit: () => ipcRenderer.send('quit'),
});
