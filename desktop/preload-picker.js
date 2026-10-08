const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("picker", {
  list: () => ipcRenderer.invoke("picker:list"),
  choose: (id, som) => ipcRenderer.send("picker:choose", id, som),
  cancel: () => ipcRenderer.send("picker:cancel"),
});
