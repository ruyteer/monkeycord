const { contextBridge, ipcRenderer } = require("electron");

// A cada compartilhamento o processo principal avisa se o som vai junto.
// A interface pega essa promessa ANTES de chamar getDisplayMedia, então não há
// corrida entre o aviso e o stream ficar pronto.
let aguardando;
let resolver;
const novaEspera = () => {
  aguardando = new Promise((r) => (resolver = r));
};
novaEspera();
ipcRenderer.on("share:som", (_e, som) => {
  const anterior = resolver;
  novaEspera();
  anterior(som);
});

contextBridge.exposeInMainWorld("monkeycord", {
  desktop: true,
  platform: process.platform,
  info: () => ipcRenderer.invoke("app:info"),
  escolhaDeSom: () => aguardando,
});
