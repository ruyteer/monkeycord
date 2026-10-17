import { useSyncExternalStore } from "react";

/**
 * Preferências de voz e vídeo (Configurações > Voz e vídeo). Ficam neste
 * aparelho. Valem na próxima vez que o microfone/câmera ligar; o volume de
 * cada pessoa vale na hora.
 */
export type VoicePrefs = {
  micId: string;
  speakerId: string;
  cameraId: string;
  /** Volume de entrada (0–200%) */
  inputGain: number;
  /** Volume de saída geral (0–200%) */
  outputVolume: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGain: boolean;
  /** Sons de entrar/sair/mutar */
  sounds: boolean;
  /** Volume por pessoa (0–200%), pelo nome */
  userVolume: Record<string, number>;
  /** Pessoas que você silenciou só pra você */
  localMute: Record<string, boolean>;
};

const KEY = "mc:voz";
const DEFAULTS: VoicePrefs = {
  micId: "default",
  speakerId: "default",
  cameraId: "default",
  inputGain: 100,
  outputVolume: 100,
  noiseSuppression: true,
  echoCancellation: true,
  autoGain: true,
  sounds: true,
  userVolume: {},
  localMute: {},
};

let prefs: VoicePrefs = load();
const listeners = new Set<() => void>();

function load(): VoicePrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<VoicePrefs>) };
  } catch {
    return DEFAULTS;
  }
}

export function getPrefs() {
  return prefs;
}

export function setPrefs(change: Partial<VoicePrefs>) {
  prefs = { ...prefs, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* sem storage */
  }
  listeners.forEach((l) => l());
}

export function subscribePrefs(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function usePrefs() {
  return useSyncExternalStore(subscribePrefs, getPrefs);
}

/** Volume final de uma pessoa (0–4, pro <audio>.volume vai até 1 e o resto é ganho). */
export function volumeFor(name: string) {
  if (prefs.localMute[name]) return 0;
  return ((prefs.userVolume[name] ?? 100) / 100) * (prefs.outputVolume / 100);
}

export function micConstraints(): MediaTrackConstraints {
  return {
    deviceId: prefs.micId !== "default" ? { exact: prefs.micId } : undefined,
    noiseSuppression: prefs.noiseSuppression,
    echoCancellation: prefs.echoCancellation,
    autoGainControl: prefs.autoGain,
    channelCount: 1,
  };
}

export function cameraConstraints(mobile: boolean): MediaTrackConstraints {
  return {
    deviceId: prefs.cameraId !== "default" ? { exact: prefs.cameraId } : undefined,
    ...(mobile
      ? { width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 24 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }),
  };
}

/** Lista de microfones, saídas e câmeras (os nomes só aparecem depois de dar permissão). */
export async function listDevices() {
  const all = await navigator.mediaDevices?.enumerateDevices().catch(() => []);
  return {
    mics: (all ?? []).filter((d) => d.kind === "audioinput"),
    speakers: (all ?? []).filter((d) => d.kind === "audiooutput"),
    cameras: (all ?? []).filter((d) => d.kind === "videoinput"),
  };
}
