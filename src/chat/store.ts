import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { defaultChannels } from "@/shell/data";
import { GatewayClient, type GatewayStatus } from "./gateway";
import {
  dmChannelId,
  isDm,
  MAX_FILE,
  Op,
  type Attachment,
  type Channel,
  type Dispatch,
  type Message as WireMessage,
  type Status,
  type VisibleStatus,
  type VoiceState,
  type VoiceUpdate,
} from "./protocol";

/**
 * Estado do chat vindo do backend na Cloudflare (worker/): canais, mensagens,
 * presença, conversas diretas, não lidas e notificações. A interface só usa
 * os hooks e as funções exportadas daqui.
 *
 * Endereço do backend: VITE_CHAT_URL; sem ela, o Worker publicado (ou o
 * `npm run dev:chat` em desenvolvimento).
 */
export type Message = WireMessage & {
  /** Mandada daqui e ainda sem confirmação do servidor */
  pending?: boolean;
  failed?: boolean;
};

export type Presence = {
  /** Nome → status de quem não está offline */
  statuses: Record<string, VisibleStatus>;
  voice: VoiceState[];
  status: GatewayStatus;
};

export type NotifyLevel = "all" | "mentions" | "none";
export type Dm = { id: string; with: string };

const PUBLISHED = "https://monkeycord-chat.monkeycord.workers.dev";
export const CHAT_BASE = resolveBase();

function resolveBase() {
  const env = import.meta.env.VITE_CHAT_URL as string | undefined;
  if (env) return env.replace(/\/$/, "");
  if (import.meta.env.DEV) return "http://127.0.0.1:8787";
  return PUBLISHED;
}

const EMPTY: Message[] = [];
const OFFLINE: Presence = { statuses: {}, voice: [], status: "offline" };

const messages = new Map<string, Message[]>();
/** Canais que alguém já abriu: recarregados depois de reconectar sem RESUME */
const wanted = new Set<string>();
const loading = new Map<string, Promise<void>>();
const loaded = new Set<string>();
let presence = OFFLINE;
let channels: Channel[] = defaultChannels;
let client: GatewayClient | null = null;
let me = "";
let myVoice: VoiceUpdate = { channelId: null, selfMute: false, selfDeaf: false };
let myStatus: Status = (safeGet("mc:status") as Status) || "online";
let dms: Dm[] = [];
let active: string | null = null;
let lastRead: Record<string, number> = readJson("mc:lido", {});
let notify: Record<string, NotifyLevel> = readJson("mc:notif", {});
/** Última mensagem de cada canal (dos outros) e quantas menções desde a última leitura */
const latest = new Map<string, number>();
const mentions = new Map<string, number>();
let version = 0;

const listeners = new Set<() => void>();
function emit() {
  version++;
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Conecta no gateway com esse nome. Devolve a função que desconecta (pra usar num useEffect). */
export function connectChat(name: string) {
  me = name;
  dms = readJson(`mc:dms:${name}`, []);
  const c = new GatewayClient({
    url: CHAT_BASE.replace(/^http/, "ws") + "/gateway",
    name,
    status: () => myStatus,
    onDispatch,
    onEphemeral: (p) => {
      if (p.op === Op.Signal) signalListeners.forEach((l) => l(p.d.from, p.d.data));
      else typingArrived(p.d.channelId, p.d.name);
    },
    onStatus: (status) => {
      presence = { ...presence, status };
      emit();
    },
  });
  client = c;
  c.connect();
  // Fechou/recarregou a página: sai na hora (senão a sessão velha fica 20s como "fantasma" no canal de voz)
  const bye = () => c.close();
  window.addEventListener("pagehide", bye);
  return () => {
    window.removeEventListener("pagehide", bye);
    c.close();
    if (client === c) client = null;
    presence = OFFLINE;
    emit();
  };
}

/* ---------- Voz P2P: sinalização pelo gateway ---------- */

type SignalListener = (from: string, data: unknown) => void;
const signalListeners = new Set<SignalListener>();

export function onSignal(fn: SignalListener) {
  signalListeners.add(fn);
  return () => void signalListeners.delete(fn);
}

export function sendSignal(to: string, data: unknown) {
  client?.send({ op: Op.Signal, d: { to, data } });
}

/** Id desta sessão no gateway (null antes do READY ou desconectado). */
export function getSessionId() {
  return client?.session ?? null;
}

/** Presença atual, fora do React (o motor da voz usa). */
export function getPresence() {
  return presence;
}

export { subscribe as subscribeChat };

let iceCache: Promise<RTCIceServer[]> | null = null;
/** STUN/TURN vindos do Worker (com STUN do Google se der erro). */
export function getIceServers() {
  iceCache ??= api<{ iceServers: RTCIceServer[] }>("/api/ice")
    .then((r) => r.iceServers)
    .catch(() => {
      iceCache = null;
      return [{ urls: "stun:stun.l.google.com:19302" }];
    });
  return iceCache;
}

/* ---------- Digitando ---------- */

/** canal → nome → até quando mostrar */
const typing = new Map<string, Map<string, number>>();
const TYPING_MS = 8000;

function typingArrived(channelId: string, name: string) {
  const byName = typing.get(channelId) ?? new Map<string, number>();
  byName.set(name, Date.now() + TYPING_MS);
  typing.set(channelId, byName);
  emit();
  setTimeout(emit, TYPING_MS + 50);
}

/** Quem está digitando agora nesse canal. */
export function typingIn(channelId: string) {
  const now = Date.now();
  const byName = typing.get(channelId);
  if (!byName) return [];
  return [...byName].filter(([, until]) => until > now).map(([n]) => n);
}

const lastTyping = new Map<string, number>();
/** Avisa que você está digitando (no máximo a cada 6s por canal, igual ao Discord). */
export function sendTyping(channelId: string) {
  const now = Date.now();
  if (now - (lastTyping.get(channelId) ?? 0) < 6000) return;
  lastTyping.set(channelId, now);
  client?.send({ op: Op.Typing, d: { channelId } });
}

/** Em qual canal de voz você está (null = nenhum) e se está mudo/surdo. */
export function updateVoiceState(channelId: string | null, selfMute: boolean, selfDeaf: boolean) {
  myVoice = { channelId, selfMute, selfDeaf };
  client?.send({ op: Op.VoiceStateUpdate, d: myVoice });
}

export function setStatus(status: Status) {
  myStatus = status;
  safeSet("mc:status", status);
  client?.send({ op: Op.PresenceUpdate, d: { status } });
  emit();
}

function onDispatch(e: Dispatch) {
  switch (e.t) {
    case "READY":
      presence = {
        statuses: Object.fromEntries(e.d.presences.map((p) => [p.name, p.status])),
        voice: e.d.voice,
        status: "ready",
      };
      channels = e.d.channels;
      // Sessão nova: pode ter perdido mensagens enquanto estava fora
      wanted.forEach((id) => void load(id, true));
      client?.send({ op: Op.VoiceStateUpdate, d: myVoice });
      break;
    case "RESUMED":
      // Se mexeu na voz enquanto estava desconectado
      client?.send({ op: Op.VoiceStateUpdate, d: myVoice });
      client?.send({ op: Op.PresenceUpdate, d: { status: myStatus } });
      return;
    case "MESSAGE_CREATE":
      typing.get(e.d.channelId)?.delete(e.d.author);
      insert(e.d);
      arrived(e.d);
      break;
    case "MESSAGE_UPDATE":
      insert(e.d);
      break;
    case "MESSAGE_DELETE": {
      const list = messages.get(e.d.channelId);
      if (list) messages.set(e.d.channelId, list.filter((m) => m.id !== e.d.id));
      break;
    }
    case "CHANNEL_CREATE":
      channels = [...channels.filter((c) => c.id !== e.d.id), e.d];
      break;
    case "CHANNEL_DELETE":
      channels = channels.filter((c) => c.id !== e.d.id);
      break;
    case "PRESENCE_UPDATE": {
      const statuses = { ...presence.statuses };
      if (e.d.status === "offline") delete statuses[e.d.name];
      else statuses[e.d.name] = e.d.status;
      presence = { ...presence, statuses };
      break;
    }
    case "VOICE_STATE_UPDATE": {
      const { channelId, ...rest } = e.d;
      const voice = presence.voice.filter((v) => v.sessionId !== rest.sessionId);
      if (channelId) voice.push({ ...rest, channelId });
      presence = { ...presence, voice };
      break;
    }
    default:
      return;
  }
  emit();
}

/** Mensagem nova dos outros: não lida, menção, conversa direta nova e notificação. */
function arrived(m: WireMessage) {
  if (m.author === me) return;
  latest.set(m.channelId, Math.max(latest.get(m.channelId) ?? 0, m.ts));
  const mentioned = mentionsMe(m.content) || isDm(m.channelId);
  lastTyping.delete(m.channelId);
  const reading = active === m.channelId && !document.hidden;
  if (reading) markRead(m.channelId);
  else if (mentioned) mentions.set(m.channelId, (mentions.get(m.channelId) ?? 0) + 1);

  if (isDm(m.channelId) && !dms.some((d) => d.id === m.channelId)) {
    dms = [{ id: m.channelId, with: m.author }, ...dms];
    safeSet(`mc:dms:${me}`, JSON.stringify(dms));
  }

  const level = notifyLevel(m.channelId);
  const wants = level === "all" || (level === "mentions" && mentioned);
  if (reading || !wants || myStatus === "dnd") return;
  const where = isDm(m.channelId) ? m.author : `${m.author} (#${channelName(m.channelId)})`;
  const text = m.content || (m.attachments?.length ? "📎 Enviou um arquivo" : "");
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    const n = new Notification(where, { body: text.slice(0, 140), tag: m.channelId, silent: false });
    n.onclick = () => {
      window.focus();
      window.monkeycord?.show();
      openChannelHandler?.(m.channelId);
      n.close();
    };
  } else if (!document.hidden) {
    toast(where, { description: text.slice(0, 140), action: { label: "Abrir", onClick: () => openChannelHandler?.(m.channelId) } });
  }
}

let openChannelHandler: ((id: string) => void) | null = null;
/** O shell registra como abrir um canal (clique na notificação). */
export function onOpenChannel(fn: (id: string) => void) {
  openChannelHandler = fn;
  return () => {
    if (openChannelHandler === fn) openChannelHandler = null;
  };
}

export function mentionsMe(content: string) {
  if (!me) return false;
  const esc = me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@(${esc}|everyone|todos)(?![\\p{L}\\p{N}_])`, "iu").test(content);
}

function channelName(id: string) {
  return channels.find((c) => c.id === id)?.name ?? id;
}

/** Canal aberto agora: marca como lido e não notifica. */
export function setActiveChannel(id: string | null) {
  active = id;
  if (id) markRead(id);
}

export function markRead(channelId: string) {
  const list = messages.get(channelId);
  const ts = Math.max(Date.now(), list?.at(-1)?.ts ?? 0);
  const had = mentions.has(channelId) || (latest.get(channelId) ?? 0) > (lastRead[channelId] ?? 0);
  lastRead = { ...lastRead, [channelId]: ts };
  mentions.delete(channelId);
  safeSet("mc:lido", JSON.stringify(lastRead));
  if (had) emit();
}

export function notifyLevel(channelId: string): NotifyLevel {
  return notify[channelId] ?? "all";
}

export function setNotifyLevel(channelId: string, level: NotifyLevel) {
  notify = { ...notify, [channelId]: level };
  safeSet("mc:notif", JSON.stringify(notify));
  if (level !== "none" && "Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission();
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
  const busy = loading.get(channelId);
  if (busy) return busy;
  if (!force && loaded.has(channelId)) return Promise.resolve();
  const p = api<WireMessage[]>(`/api/channels/${encodeURIComponent(channelId)}/messages?limit=100`)
    .then((list) => {
      merge(channelId, list);
      loaded.add(channelId);
      const theirs = list.filter((m) => m.author !== me).at(-1);
      if (theirs) {
        latest.set(channelId, Math.max(latest.get(channelId) ?? 0, theirs.ts));
        // Primeira vez que vê o canal neste aparelho: o histórico antigo não conta como não lido
        if (lastRead[channelId] == null) {
          lastRead = { ...lastRead, [channelId]: theirs.ts };
          safeSet("mc:lido", JSON.stringify(lastRead));
        }
      }
      if (active === channelId) markRead(channelId);
      emit();
    })
    .catch((err) => console.warn(`[chat] histórico de ${channelId} não carregou`, err))
    .finally(() => loading.delete(channelId));
  loading.set(channelId, p);
  return p;
}

/** Carrega 100 mensagens antes da mais antiga que já tem. Devolve quantas vieram. */
export async function loadOlder(channelId: string): Promise<number> {
  const first = messages.get(channelId)?.find((m) => !m.pending);
  if (!first) return 0;
  try {
    const list = await api<WireMessage[]>(
      `/api/channels/${encodeURIComponent(channelId)}/messages?limit=100&before=${first.ts}`
    );
    merge(channelId, list);
    emit();
    return list.length;
  } catch {
    return 0;
  }
}

/** Busca o histórico dos canais de texto pra saber o que está sem ler. */
export function preloadChannels() {
  for (const c of channels) if (c.kind === "text") void load(c.id);
  for (const d of dms) void load(d.id);
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

export function useChannels() {
  return useSyncExternalStore(subscribe, () => channels);
}

export function useDms() {
  return useSyncExternalStore(subscribe, () => dms);
}

export function useMyStatus() {
  return useSyncExternalStore(subscribe, () => myStatus);
}

/** Muda a cada evento: pra quem precisa recalcular não lidas/notificações. */
export function useChatVersion() {
  return useSyncExternalStore(subscribe, () => version);
}

/** Até quando você já leu esse canal (pra linha de "NOVAS"). */
export function lastReadOf(channelId: string) {
  return lastRead[channelId] ?? 0;
}

export function unreadState(channelId: string) {
  const read = lastRead[channelId] ?? 0;
  return { unread: (latest.get(channelId) ?? 0) > read, mentions: mentions.get(channelId) ?? 0 };
}

export function openDm(other: string): Dm {
  const id = dmChannelId(me, other);
  let dm = dms.find((d) => d.id === id);
  if (!dm) {
    dm = { id, with: other };
    dms = [dm, ...dms];
    safeSet(`mc:dms:${me}`, JSON.stringify(dms));
    emit();
  }
  return dm;
}

export function closeDm(id: string) {
  dms = dms.filter((d) => d.id !== id);
  safeSet(`mc:dms:${me}`, JSON.stringify(dms));
  emit();
}

export function sendMessage(
  channelId: string,
  author: string,
  content: string,
  attachments: Attachment[] = [],
  replyTo?: Message
) {
  const text = content.trim();
  if (!text && !attachments.length) return;
  const nonce = crypto.randomUUID();
  const reply = replyTo ? { id: replyTo.id, author: replyTo.author, content: replyTo.content.slice(0, 120) } : undefined;
  insert({ id: nonce, nonce, channelId, author, content: text, ts: Date.now(), pending: true, attachments, replyTo: reply });
  markRead(channelId);
  emit();

  const dm = dms.find((d) => d.id === channelId);
  api<WireMessage>(`/api/channels/${encodeURIComponent(channelId)}/messages`, "POST", {
    author,
    content: text,
    nonce,
    attachments,
    members: dm ? [author, dm.with] : undefined,
    replyTo: replyTo?.id,
  })
    .then((m) => {
      insert(m);
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

/** Tira da lista uma mensagem que falhou ao enviar. */
export function discardMessage(channelId: string, id: string) {
  const list = messages.get(channelId);
  if (list) messages.set(channelId, list.filter((m) => m.id !== id));
  emit();
}

const msgPath = (channelId: string, id: string) =>
  `/api/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(id)}`;

/** Aplica já na tela e confirma com o servidor; se der erro, volta como estava. */
async function optimistic(channelId: string, id: string, change: (m: Message) => Message | null, call: () => Promise<unknown>) {
  const before = messages.get(channelId) ?? EMPTY;
  const next: Message[] = [];
  for (const m of before) {
    if (m.id !== id) next.push(m);
    else {
      const c = change(m);
      if (c) next.push(c);
    }
  }
  messages.set(channelId, next);
  emit();
  try {
    const res = await call();
    if (res && typeof res === "object" && "id" in res) insert(res as WireMessage);
    emit();
  } catch (err) {
    messages.set(channelId, before);
    emit();
    toast.error("Não rolou", { description: (err as Error).message });
  }
}

export function editMessage(m: Message, content: string) {
  const text = content.trim();
  if (text === m.content) return;
  return optimistic(m.channelId, m.id, (x) => ({ ...x, content: text, editedTs: Date.now() }), () =>
    api(msgPath(m.channelId, m.id), "PATCH", { author: me, content: text })
  );
}

export function deleteMessage(m: Message) {
  if (m.pending || m.failed) return discardMessage(m.channelId, m.id);
  return optimistic(m.channelId, m.id, () => null, () => api(msgPath(m.channelId, m.id), "DELETE", { author: me }));
}

export function pinMessage(m: Message, on: boolean) {
  return optimistic(m.channelId, m.id, (x) => ({ ...x, pinned: on }), () =>
    api(`${msgPath(m.channelId, m.id)}/pin`, on ? "PUT" : "DELETE")
  ).then(() => toast(on ? "Mensagem fixada" : "Mensagem desafixada"));
}

export function toggleReaction(m: Message, emoji: string) {
  const mine = m.reactions?.find((r) => r.emoji === emoji)?.users.includes(me);
  const change = (x: Message): Message => {
    const list = (x.reactions ?? []).map((r) => ({ ...r, users: [...r.users] }));
    const r = list.find((y) => y.emoji === emoji);
    if (mine && r) r.users = r.users.filter((u) => u !== me);
    else if (r) r.users.push(me);
    else list.push({ emoji, users: [me] });
    return { ...x, reactions: list.filter((y) => y.users.length) };
  };
  return optimistic(m.channelId, m.id, change, () =>
    api(`${msgPath(m.channelId, m.id)}/reactions`, mine ? "DELETE" : "PUT", { emoji, user: me })
  );
}

export function fetchPins(channelId: string) {
  return api<WireMessage[]>(`/api/channels/${encodeURIComponent(channelId)}/pins`);
}

export function searchMessages(channelId: string, q: string) {
  return api<WireMessage[]>(`/api/channels/${encodeURIComponent(channelId)}/search?q=${encodeURIComponent(q)}`);
}

export function fileUrl(channelId: string, a: Attachment) {
  return `${CHAT_BASE}/api/channels/${encodeURIComponent(channelId)}/files/${a.id}`;
}

/** Sobe um arquivo. Imagens grandes são reduzidas pra caber no limite. */
export async function uploadFile(channelId: string, file: File): Promise<Attachment> {
  let blob: Blob = file;
  let width: number | undefined;
  let height: number | undefined;
  if (/^image\/(png|jpeg|webp)$/.test(file.type)) {
    const shrunk = await shrinkImage(file);
    blob = shrunk.blob;
    width = shrunk.width;
    height = shrunk.height;
  } else if (file.type.startsWith("image/")) {
    const dims = await imageSize(file).catch(() => null);
    width = dims?.width;
    height = dims?.height;
  }
  if (blob.size > MAX_FILE) throw new Error(`${file.name} passa de 2 MB`);
  const res = await fetch(`${CHAT_BASE}/api/channels/${encodeURIComponent(channelId)}/files`, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name),
      ...(width ? { "X-Width": String(width), "X-Height": String(height) } : {}),
    },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as Attachment;
}

async function imageSize(file: Blob) {
  const bmp = await createImageBitmap(file);
  const out = { width: bmp.width, height: bmp.height };
  bmp.close();
  return out;
}

async function shrinkImage(file: File) {
  const bmp = await createImageBitmap(file);
  let { width, height } = bmp;
  // Já cabe e não é enorme: manda o original
  if (file.size <= MAX_FILE && Math.max(width, height) <= 2560) {
    bmp.close();
    return { blob: file as Blob, width, height };
  }
  const scale = Math.min(1, 2048 / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  let quality = 0.88;
  let blob: Blob | null = null;
  while (quality > 0.4) {
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
    if (blob && blob.size <= MAX_FILE) break;
    quality -= 0.15;
  }
  return { blob: blob ?? file, width, height };
}

export function createChannel(name: string, kind: "text" | "voice") {
  return api<Channel>("/api/channels", "POST", { name, kind }).then((ch) => {
    channels = [...channels.filter((c) => c.id !== ch.id), ch];
    emit();
    return ch;
  });
}

export function deleteChannel(id: string) {
  return api(`/api/channels/${encodeURIComponent(id)}`, "DELETE").then(() => {
    channels = channels.filter((c) => c.id !== id);
    emit();
  });
}

async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(CHAT_BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* modo privado */
  }
}
function readJson<T>(k: string, fallback: T): T {
  try {
    const raw = safeGet(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
