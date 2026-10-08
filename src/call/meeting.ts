import RealtimeKitClient from "@cloudflare/realtimekit";

export type Meeting = Awaited<ReturnType<typeof RealtimeKitClient.init>>;

export const isMobile =
  typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/**
 * Compartilhamento de tela pensado pra filme:
 * - 1080p a 30fps (o preset do app também foi para fhd/30fps);
 * - contentHint "motion": o encoder prefere manter o fps a nitidez de texto;
 * - áudio da aba/sistema sem processamento de voz (eco/ruído/ganho distorcem música).
 * O SDK chama getDisplayMedia internamente, então ajustamos a chamada aqui.
 */
declare global {
  interface Window {
    /** Só existe no app desktop (preload do Electron) */
    monkeycord?: { desktop: boolean; escolhaDeSom?: () => Promise<boolean> };
  }
}

let patched = false;
function patchDisplayMedia() {
  const md = navigator.mediaDevices;
  if (patched || !md?.getDisplayMedia) return;
  patched = true;
  const original = md.getDisplayMedia.bind(md);
  md.getDisplayMedia = async (constraints: DisplayMediaStreamOptions = {}) => {
    const video = typeof constraints.video === "object" ? constraints.video : {};
    // No app desktop: pega a escolha "com/sem som" antes de abrir o seletor
    const escolha = window.monkeycord?.escolhaDeSom?.();
    const stream = await original({
      ...constraints,
      video: {
        ...video,
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        sampleRate: 48000,
      },
      // Chrome: permite marcar "compartilhar áudio" e trocar de aba no meio
      systemAudio: "include",
      surfaceSwitching: "include",
      selfBrowserSurface: "exclude",
    } as DisplayMediaStreamOptions);
    stream.getVideoTracks().forEach((t) => (t.contentHint = "motion"));

    if (escolha) {
      // Se o aviso não chegar (não deve acontecer), assume que o som vai junto
      const comSom = await Promise.race([
        escolha,
        new Promise<boolean>((r) => setTimeout(() => r(true), 500)),
      ]);
      if (!comSom) {
        stream.getAudioTracks().forEach((t) => {
          t.stop();
          stream.removeTrack(t);
        });
      }
    }

    stream.getAudioTracks().forEach((t) => (t.contentHint = "music"));
    return stream;
  };
}

// Vale pra qualquer compartilhamento, não só os que passam pelo createMeeting
if (typeof navigator !== "undefined") patchDisplayMedia();

export async function createMeeting(authToken: string) {
  return RealtimeKitClient.init({
    authToken,
    defaults: {
      audio: true,
      video: true,
      mediaConfiguration: {
        video: isMobile
          ? // No celular em pé, pede a câmera na vertical
            { width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 24 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } },
        screenshare: {
          width: { max: 1920 },
          height: { max: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
      },
    },
  });
}

/**
 * No navegador fica vazio (mesma origem). No app desktop aponta pro site
 * publicado, pra cair na mesma sala de quem está na web.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export async function fetchToken(name: string, room: string) {
  const res = await fetch(`${API_BASE}/api/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, room }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Não deu pra entrar agora");
  return data as { authToken: string; room: string };
}
