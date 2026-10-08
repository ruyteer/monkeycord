const path = require("node:path");
const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  session,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");

// Site que serve a API (/api/join). O app entra nas mesmas salas da web.
const SITE = process.env.MONKEYCORD_SITE || "https://monkeycord.netlify.app";
const PAGE = path.join(__dirname, "renderer", "index.html");

app.setAppUserModelId("app.monkeycord.desktop");

// Uma janela só: clicar no atalho de novo foca a que já está aberta
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 380,
    minHeight: 480,
    backgroundColor: "#09090a",
    autoHideMenuBar: true,
    show: false,
    title: "MonkeyCord",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => win.show());
  win.loadFile(PAGE);

  // Link externo abre no navegador padrão, nunca numa janela do app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on("closed", () => (win = null));

  // Teste de abertura (usado no CI): carrega, confere que a tela montou e sai.
  if (process.env.MONKEYCORD_SMOKE) {
    const erros = [];
    let compartilhouOk = true;
    let apiOk = true;
    win.webContents.on("console-message", (e) => e.level === "error" && erros.push(e.message));
    win.webContents.once("did-finish-load", async () => {
      const montou = await win.webContents.executeJavaScript(
        "!!document.querySelector('#root')?.children.length"
      );
      const smoke = process.env.MONKEYCORD_SMOKE;
      // MONKEYCORD_SMOKE=api: confere se a API publicada aceita o app (CORS)
      if (smoke === "api") {
        const r = await win.webContents.executeJavaScript(
          `fetch(${JSON.stringify(SITE)} + "/api/join", {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ name: "TesteApp", room: "teste-do-app" }),
           }).then(async (res) => ({ status: res.status, token: !!(await res.json()).authToken }))
             .catch((e) => ({ erro: e.name + ": " + e.message }))`
        );
        apiOk = r.status === 200 && r.token;
        console.log(`SMOKE api=${JSON.stringify(r)}`);
      }
      if (smoke?.startsWith("share")) {
        const r = await win.webContents.executeJavaScript(
          `navigator.mediaDevices.getDisplayMedia({video:true,audio:true}).then(s=>({
             video: s.getVideoTracks().length,
             audio: s.getAudioTracks().length,
           })).catch(e=>({erro: e.name+': '+e.message}))`,
          true
        );
        // o som do Windows sempre vem junto; ligar/desligar é no botão da chamada
        compartilhouOk = r.video === 1 && r.audio === 1;
        console.log(`SMOKE compartilhamento=${JSON.stringify(r)}`);
      }
      console.log(`SMOKE tela=${montou ? "ok" : "vazia"} erros=${erros.length}`);
      erros.forEach((m) => console.log(`SMOKE erro: ${m}`));
      app.exit(montou && erros.length === 0 && compartilhouOk && apiOk ? 0 : 1);
    });
  }
}

/**
 * Janela de escolha do que compartilhar: a fonte e se o som do computador vai
 * junto. Devolve { source, som } ou null se cancelar.
 */
function pickSource(sources) {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      width: 760,
      height: 560,
      parent: win ?? undefined,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      backgroundColor: "#09090a",
      autoHideMenuBar: true,
      title: "Compartilhar tela",
      webPreferences: {
        preload: path.join(__dirname, "preload-picker.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    let answered = false;
    const done = (id) => {
      if (answered) return;
      answered = true;
      resolve(sources.find((s) => s.id === id) ?? null);
      if (!picker.isDestroyed()) picker.close();
    };

    ipcMain.handleOnce("picker:list", () =>
      sources.map((s) => ({
        id: s.id,
        name: s.name,
        tela: s.id.startsWith("screen"),
        thumb: s.thumbnail.toDataURL(),
      }))
    );
    ipcMain.once("picker:choose", (_e, id) => done(id));
    ipcMain.once("picker:cancel", () => done(null));
    picker.on("closed", () => {
      ipcMain.removeHandler("picker:list");
      done(null);
    });

    picker.loadFile(path.join(__dirname, "picker.html"));
  });
}

app.whenReady().then(() => {
  const ses = session.defaultSession;

  // Câmera, microfone e compartilhamento de tela liberados só pra nossa página
  const allowed = new Set(["media", "display-capture", "clipboard-sanitized-write", "fullscreen"]);
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(wc.getURL().startsWith("file://") && allowed.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // Compartilhamento de tela COM o áudio do sistema (filme sai com som)
  ses.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 320, height: 180 },
        });
        // MONKEYCORD_SMOKE=share: teste automático, sem abrir o seletor
        const source = process.env.MONKEYCORD_SMOKE?.startsWith("share")
          ? sources[0]
          : await pickSource(sources);
        if (!source) return callback({});
        // "loopback" = todo o som do Windows. Quem apresenta liga e desliga esse
        // som pelo botão da barra da chamada (a faixa continua, só vai muda).
        callback({ video: source, audio: "loopback" });
      } catch (e) {
        console.error(e);
        callback({});
      }
    },
    // No Windows 11 usa o seletor nativo quando existir
    { useSystemPicker: true }
  );

  createWindow();

  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    // Confere de novo a cada 6 horas, pra pegar versão nova sem reabrir o app
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("app:info", () => ({ version: app.getVersion(), site: SITE }));
