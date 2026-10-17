const { contextBridge, ipcRenderer } = require("electron");

/** Assina um canal do processo principal e devolve a função que cancela. */
function listen(channel, cb) {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

// Única ponte entre a página e o Electron (tipos em src/desktop.ts). Nada de Node solto no site.
contextBridge.exposeInMainWorld("monkeycord", {
  desktop: true,
  platform: process.platform,
  info: () => ipcRenderer.invoke("app:info"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (s) => ipcRenderer.invoke("settings:set", s),
  setBadge: (count, unread, dataUrl) => ipcRenderer.send("app:badge", { count, unread, dataUrl }),
  flash: () => ipcRenderer.send("app:flash"),
  show: () => ipcRenderer.send("app:show"),
  setVoiceState: (s) => ipcRenderer.send("app:voice", s),
  onCommand: (cb) => listen("command", cb),
  onUpdate: (cb) => listen("update", cb),
  checkUpdates: () => ipcRenderer.send("update:check"),
  installUpdate: () => ipcRenderer.send("update:install"),
});
