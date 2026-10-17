/**
 * Ponte com o app desktop (Electron, desktop/preload.js). No navegador não
 * existe: tudo aqui vira "não faz nada".
 */
export type DesktopSettings = {
  /** Abrir junto com o Windows */
  openAtLogin: boolean;
  /** Fechar a janela só esconde (fica na bandeja), igual ao Discord */
  closeToTray: boolean;
  /** Atalhos globais (funcionam com o app em segundo plano) */
  globalShortcuts: boolean;
};

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "downloading"; percent: number }
  | { status: "ready"; version: string }
  | { status: "none" }
  | { status: "error"; message: string };

type Bridge = {
  desktop: true;
  platform: string;
  info(): Promise<{ version: string }>;
  getSettings(): Promise<DesktopSettings>;
  setSettings(s: Partial<DesktopSettings>): Promise<DesktopSettings>;
  /** Contagem de menções/não lidas pro ícone da barra de tarefas */
  setBadge(count: number, unread: boolean, dataUrl: string | null): void;
  /** Pisca o ícone na barra de tarefas */
  flash(): void;
  /** Mostra e foca a janela (clique em notificação) */
  show(): void;
  /** Estado da chamada pro menu da bandeja */
  setVoiceState(s: { inVoice: boolean; muted: boolean; deafened: boolean }): void;
  onCommand(cb: (cmd: "toggleMute" | "toggleDeafen" | "disconnect" | "openSettings" | `open:${string}`) => void): () => void;
  onUpdate(cb: (s: UpdateState) => void): () => void;
  checkUpdates(): void;
  installUpdate(): void;
};

declare global {
  interface Window {
    monkeycord?: Bridge;
  }
}

export const desktop: Bridge | null = typeof window !== "undefined" && window.monkeycord?.desktop ? window.monkeycord : null;
export const isDesktop = !!desktop;

/** Desenha o selo vermelho com o número (vai como overlay no ícone da barra de tarefas). */
export function badgeImage(count: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ef4444";
  g.beginPath();
  g.arc(16, 16, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.font = `bold ${count > 9 ? 16 : 20}px sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(count > 99 ? "99+" : String(count), 16, 17);
  return c.toDataURL();
}
