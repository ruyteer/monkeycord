import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { GatewayClient, type GatewayStatus } from "./gateway";
import { Op, type Dispatch, type Message as WireMessage, type VoiceState, type VoiceUpdate } from "./protocol";

/**
 * Mensagens dos canais de texto e presença, vindas do backend na Cloudflare
 * (worker/). A interface só fala com `useMessages`, `sendMessage`,
 * `usePresence`, `connectChat` e `updateVoiceState`.
 *
 * Endereço do backend: VITE_CHAT_URL. Em dev, o `npm run dev:chat` (porta 8787).
 * Sem endereço (build sem VITE_CHAT_URL), as mensagens ficam só na memória desta aba.
 */
export type Message = WireMessage & {
  /** Mandada daqui e ainda sem confirmação do servidor */
  pending?: boolean;
  failed?: boolean;
};

export type Presence = { online: string[]; voice: VoiceState[]; status: GatewayStatus };

const BASE = resolveBase();

function resolveBase() {
  const env = import.meta.env.VITE_CHAT_URL as string | undefined;
  if (env) return env.replace(/\/$/, "");
  if (import.meta.env.DEV) return "http://127.0.0.1:8787";
  return null;
}

const EMPTY: Message[] = [];
const OFFLINE: Presence = { online: [], voice: [], status: "offline" };

const messages = new Map<string, Message[]>();
/** Canais que alguém já abriu: recarregados depois de reconectar sem RESUME */
const wanted = new Set<string>();
const loading = new Map<string, Promise<void>>();
const loaded = new Set<string>();
let presence = OFFLINE;
let client: GatewayClient | null = null;
let myVoice: VoiceUpdate = { channelId: null, selfMute: false, selfDeaf: false };

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Conecta no gateway com esse nome. Devolve a função que desconecta (pra usar num useEffect). */
export function connectChat(name: string) {
  if (!BASE) {
    presence = { online: [name], voice: [], status: "ready" };
    emit();
    return () => {
      presence = OFFLINE;
      emit();
    };
  }
  const c = new GatewayClient({
    url: BASE.replace(/^http/, "ws") + "/gateway",
    name,
    onDispatch,
    onStatus: (status) => {
      presence = { ...presence, status };
      emit();
    },
  });
  client = c;
  c.connect();
  return () => {
    c.close();
    if (client === c) client = null;
    presence = OFFLINE;
    emit();
  };
}

/** Em qual canal de voz você está (null = nenhum) e se está mudo/surdo. */
export function updateVoiceState(channelId: string | null, selfMute: boolean, selfDeaf: boolean) {
  myVoice = { channelId, selfMute, selfDeaf };
  client?.send({ op: Op.VoiceStateUpdate, d: myVoice });
}

function onDispatch(e: Dispatch) {
  switch (e.t) {
    case "READY":
      presence = { online: e.d.online, voice: e.d.voice, status: "ready" };
      // Sessão nova: pode ter perdido mensagens enquanto estava fora
      wanted.forEach((id) => void load(id, true));
      client?.send({ op: Op.VoiceStateUpdate, d: myVoice });
      break;
    case "RESUMED":
      // Se mexeu na voz enquanto estava desconectado
      client?.send({ op: Op.VoiceStateUpdate, d: myVoice });
      return;
    case "MESSAGE_CREATE":
      insert(e.d);
      break;
    case "PRESENCE_UPDATE": {
      const { name, status } = e.d;
      const online = presence.online.filter((n) => n !== name);
      if (status === "online") online.push(name);
      presence = { ...presence, online: online.sort((a, b) => a.localeCompare(b)) };
      break;
    }
    case "VOICE_STATE_UPDATE": {
      const { channelId, ...rest } = e.d;
      const voice = presence.voice.filter((v) => v.sessionId !== rest.sessionId);
      if (channelId) voice.push({ ...rest, channelId });
      presence = { ...presence, voice };
      break;
    }
  }
  emit();
}

/** Junta mensagens novas com as que já tem: sem repetir, trocando a otimista pela real, em ordem. */
function merge(channelId: string, incoming: Message[]) {
  const byId = new Map<string, Message>();
  for (const m of messages.get(channelId) ?? EMPTY) byId.set(m.id, m);
  for (const m of incoming) {
    if (m.nonce) byId.delete(m.nonce);
    byId.set(m.id, m);
  }
  messages.set(channelId, [...byId.values()].sort((a, b) => a.ts - b.ts));
}

function insert(m: Message) {
  merge(m.channelId, [m]);
}

function load(channelId: string, force = false): Promise<void> {
  wanted.add(channelId);
  if (!BASE) return Promise.resolve();
  const busy = loading.get(channelId);
  if (busy) return busy;
  if (!force && loaded.has(channelId)) return Promise.resolve();
  const p = fetch(`${BASE}/api/channels/${encodeURIComponent(channelId)}/messages?limit=100`)
    .then((r) => (r.ok ? (r.json() as Promise<WireMessage[]>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((list) => {
      merge(channelId, list);
      loaded.add(channelId);
      emit();
    })
    .catch((err) => console.warn(`[chat] histórico de #${channelId} não carregou`, err))
    .finally(() => loading.delete(channelId));
  loading.set(channelId, p);
  return p;
}

export function useMessages(channelId: string) {
  const sub = useCallback(
    (cb: () => void) => {
      const off = subscribe(cb);
      void load(channelId);
      return off;
    },
    [channelId]
  );
  return useSyncExternalStore(sub, () => messages.get(channelId) ?? EMPTY);
}

export function usePresence() {
  return useSyncExternalStore(subscribe, () => presence);
}

export function sendMessage(channelId: string, author: string, content: string) {
  const text = content.trim();
  if (!text) return;
  const nonce = crypto.randomUUID();
  insert({ id: nonce, nonce, channelId, author, content: text, ts: Date.now(), pending: !!BASE });
  emit();
  if (!BASE) return;

  fetch(`${BASE}/api/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ author, content: text, nonce }),
  })
    .then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
      insert(data as WireMessage);
      emit();
    })
    .catch((err: Error) => {
      const list = messages.get(channelId) ?? EMPTY;
      messages.set(
        channelId,
        list.map((m) => (m.id === nonce ? { ...m, pending: false, failed: true } : m))
      );
      emit();
      toast.error("Mensagem não enviada", { description: err.message });
    });
}
