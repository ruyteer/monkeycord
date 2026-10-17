const fs = require("node:fs");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
} = require("electron");
const { autoUpdater } = require("electron-updater");

const PAGE = path.join(__dirname, "renderer", "index.html");
const ICON = path.join(__dirname, "build", "icon.png");
const PROTOCOL = "monkeycord";

app.setAppUserModelId("app.monkeycord.desktop");

// Uma janela só: clicar no atalho de novo (ou num link monkeycord://) foca a que já está aberta
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Links monkeycord://sala/<nome> abrem o app direto no canal de voz
if (process.defaultApp) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

/* ---------- Preferências do app (ficam em %APPDATA%/MonkeyCord/preferencias.json) ---------- */

const PREFS_FILE = () => path.join(app.getPath("userData"), "preferencias.json");
const DEFAULT_PREFS = { closeToTray: true, globalShortcuts: true };

function readPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(PREFS_FILE(), "utf8")) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
let prefs = DEFAULT_PREFS;

function currentSettings() {
  return {
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    closeToTray: prefs.closeToTray,
    globalShortcuts: prefs.globalShortcuts,
  };
}

let win = null;
let tray = null;
let quitting = false;
let voice = { inVoice: false, muted: false, deafened: false };
let pendingLink = null;

/* ---------- Janela ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 500,
    backgroundColor: "#050506",
    show: false,
    title: "MonkeyCord",
    icon: ICON,
    // Barra de título própria (igual ao Discord): os botões são os do Windows, nas nossas cores
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#050506", symbolColor: "#ababab", height: 22 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chamada continua normal com a janela escondida na bandeja
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => {
    if (!process.argv.includes("--hidden")) win.show();
  });
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
  win.webContents.on("did-finish-load", () => {
    if (pendingLink) openLink(pendingLink);
    pendingLink = null;
    send("update", updateState);
  });

  // X da janela: esconde na bandeja (dá pra mudar nas configurações)
  win.on("close", (e) => {
    if (!quitting && prefs.closeToTray && !process.env.MONKEYCORD_SMOKE) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("focus", () => win.flashFrame(false));
  win.on("closed", () => (win = null));

  if (process.env.MONKEYCORD_SMOKE) smokeTest();
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* ---------- Bandeja ---------- */

function trayIcon() {
  return nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
}

function buildTray() {
  if (!tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip("MonkeyCord");
    tray.on("click", showWindow);
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir o MonkeyCord", click: showWindow },
      { type: "separator" },
      {
        label: "Mutar microfone",
        type: "checkbox",
        checked: voice.muted || voice.deafened,
        click: () => send("command", "toggleMute"),
      },
      {
        label: "Desativar áudio",
        type: "checkbox",
        checked: voice.deafened,
        click: () => send("command", "toggleDeafen"),
      },
      { label: "Sair da voz", enabled: voice.inVoice, click: () => send("command", "disconnect") },
      { type: "separator" },
      {
        label: "Configurações",
        click: () => {
          showWindow();
          send("command", "openSettings");
        },
      },
      { label: "Procurar atualização", click: () => checkUpdates() },
      { type: "separator" },
      {
        label: "Fechar o MonkeyCord",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
}

/* ---------- Atalhos globais (funcionam com o app em segundo plano) ---------- */

function applyShortcuts() {
  globalShortcut.unregisterAll();
  if (!prefs.globalShortcuts) return;
  globalShortcut.register("CommandOrControl+Shift+M", () => send("command", "toggleMute"));
  globalShortcut.register("CommandOrControl+Shift+D", () => send("command", "toggleDeafen"));
}

/* ---------- Links monkeycord:// ---------- */

function linkFrom(argv) {
  return argv.find((a) => a.startsWith(`${PROTOCOL}://`)) ?? null;
}

function openLink(url) {
  // monkeycord://sala/geral → entra no canal de voz "geral"
  const m = url.match(/^monkeycord:\/\/(?:sala|voz)\/([^/?#]+)/i);
  if (m) send("command", `open:${decodeURIComponent(m[1])}`);
}

/* ---------- Atualização automática pelo GitHub Releases ---------- */

let updateState = { status: "idle" };
function setUpdate(s) {
  updateState = s;
  send("update", s);
}

function checkUpdates() {
  if (!app.isPackaged) return setUpdate({ status: "none" });
  setUpdate({ status: "checking" });
  autoUpdater.checkForUpdates().catch((e) => setUpdate({ status: "error", message: String(e?.message ?? e) }));
}

function setupUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (i) => setUpdate({ status: "available", version: i.version }));
  autoUpdater.on("update-not-available", () => setUpdate({ status: "none" }));
  autoUpdater.on("download-progress", (p) => setUpdate({ status: "downloading", percent: p.percent }));
  autoUpdater.on("update-downloaded", (i) => setUpdate({ status: "ready", version: i.version }));
  autoUpdater.on("error", (e) => setUpdate({ status: "error", message: String(e?.message ?? e) }));
  if (!app.isPackaged) return;
  checkUpdates();
  // Confere de novo a cada 4 horas, pra pegar versão nova sem reabrir o app
  setInterval(checkUpdates, 4 * 60 * 60 * 1000);
}

/* ---------- Compartilhar tela ---------- */

/**
 * Janela de escolha do que compartilhar. Devolve a fonte escolhida ou null.
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

/* ---------- Teste de abertura (CI) ---------- */

function smokeTest() {
  const erros = [];
  let compartilhouOk = true;
  win.webContents.on("console-message", (e) => e.level === "error" && erros.push(e.message));
  win.webContents.once("did-finish-load", async () => {
    // Espera o React montar
    await new Promise((r) => setTimeout(r, 1500));
    const montou = await win.webContents.executeJavaScript("!!document.querySelector('#root')?.children.length");
    const ponte = await win.webContents.executeJavaScript("!!window.monkeycord?.desktop");
    if (process.env.MONKEYCORD_SMOKE?.startsWith("share")) {
      const r = await win.webContents.executeJavaScript(
        `navigator.mediaDevices.getDisplayMedia({video:true,audio:true}).then(s=>({
           video: s.getVideoTracks().length,
           audio: s.getAudioTracks().length,
         })).catch(e=>({erro: e.name+': '+e.message}))`,
        true
      );
      compartilhouOk = r.video === 1 && r.audio === 1;
      console.log(`SMOKE compartilhamento=${JSON.stringify(r)}`);
    }
    // MONKEYCORD_SHOT=arquivo.png: salva um print da janela (pra conferir o visual)
    if (process.env.MONKEYCORD_SHOT) {
      win.showInactive();
      await new Promise((r) => setTimeout(r, 800));
      fs.writeFileSync(process.env.MONKEYCORD_SHOT, (await win.webContents.capturePage()).toPNG());
    }
    console.log(`SMOKE tela=${montou ? "ok" : "vazia"} ponte=${ponte} erros=${erros.length}`);
    erros.forEach((m) => console.log(`SMOKE erro: ${m}`));
    app.exit(montou && ponte && erros.length === 0 && compartilhouOk ? 0 : 1);
  });
}

/* ---------- Início ---------- */

app.whenReady().then(() => {
  prefs = readPrefs();
  const ses = session.defaultSession;

  // Câmera, microfone, notificações e compartilhamento de tela liberados só pra nossa página
  const allowed = new Set(["media", "display-capture", "notifications", "clipboard-sanitized-write", "fullscreen"]);
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
        const source = process.env.MONKEYCORD_SMOKE?.startsWith("share") ? sources[0] : await pickSource(sources);
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

  pendingLink = linkFrom(process.argv);
  createWindow();
  if (!process.env.MONKEYCORD_SMOKE) {
    buildTray();
    applyShortcuts();
  }
  setupUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", (_e, argv) => {
  showWindow();
  const link = linkFrom(argv);
  if (link) openLink(link);
});

app.on("before-quit", () => (quitting = true));
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ---------- Ponte com a página (desktop/preload.js) ---------- */

ipcMain.handle("app:info", () => ({ version: app.getVersion() }));
ipcMain.handle("settings:get", () => currentSettings());
ipcMain.handle("settings:set", (_e, change) => {
  if (typeof change?.openAtLogin === "boolean") {
    app.setLoginItemSettings({ openAtLogin: change.openAtLogin, args: ["--hidden"] });
  }
  if (typeof change?.closeToTray === "boolean") prefs.closeToTray = change.closeToTray;
  if (typeof change?.globalShortcuts === "boolean") prefs.globalShortcuts = change.globalShortcuts;
  try {
    fs.writeFileSync(PREFS_FILE(), JSON.stringify(prefs, null, 2));
  } catch (e) {
    console.error(e);
  }
  applyShortcuts();
  return currentSettings();
});
ipcMain.on("app:badge", (_e, { count, unread, dataUrl }) => {
  if (!win) return;
  win.setOverlayIcon(dataUrl ? nativeImage.createFromDataURL(dataUrl) : null, count ? `${count} menções` : "");
  tray?.setToolTip(count ? `MonkeyCord (${count})` : unread ? "MonkeyCord (mensagens novas)" : "MonkeyCord");
});
ipcMain.on("app:flash", () => {
  if (win && !win.isFocused()) win.flashFrame(true);
});
ipcMain.on("app:show", showWindow);
ipcMain.on("app:voice", (_e, s) => {
  voice = { inVoice: !!s?.inVoice, muted: !!s?.muted, deafened: !!s?.deafened };
  if (tray) buildTray();
});
ipcMain.on("update:check", checkUpdates);
ipcMain.on("update:install", () => {
  quitting = true;
  autoUpdater.quitAndInstall(false, true);
});
