const { contextBridge, ipcRenderer } = require("electron");

// Única ponte entre a página e o Electron. Nada de Node solto no site.
contextBridge.exposeInMainWorld("monkeycord", {
  desktop: true,
  platform: process.platform,
  info: () => ipcRenderer.invoke("app:info"),
});
