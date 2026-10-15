import { useSyncExternalStore } from "react";

/**
 * Mensagens dos canais de texto.
 *
 * Por enquanto ficam só neste aparelho (localStorage). A interface só fala com
 * `useMessages` e `sendMessage`, então dá pra trocar por um backend de verdade
 * (WebSocket/Durable Objects) sem mexer nos componentes.
 */
export type Message = {
  id: string;
  channelId: string;
  author: string;
  content: string;
  ts: number;
};

const EMPTY: Message[] = [];
const cache = new Map<string, Message[]>();
const listeners = new Set<() => void>();

const key = (channelId: string) => `mc:msgs:${channelId}`;

function load(channelId: string): Message[] {
  const hit = cache.get(channelId);
  if (hit) return hit;
  let list = EMPTY;
  try {
    const raw = localStorage.getItem(key(channelId));
    if (raw) list = JSON.parse(raw) as Message[];
  } catch {
    /* sem storage ou JSON quebrado */
  }
  cache.set(channelId, list);
  return list;
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Outra aba mandou mensagem
  const onStorage = (e: StorageEvent) => {
    if (!e.key?.startsWith("mc:msgs:")) return;
    cache.delete(e.key.slice("mc:msgs:".length));
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useMessages(channelId: string) {
  return useSyncExternalStore(subscribe, () => load(channelId));
}

export function sendMessage(channelId: string, author: string, content: string) {
  const text = content.trim();
  if (!text) return;
  const msg: Message = { id: crypto.randomUUID(), channelId, author, content: text, ts: Date.now() };
  const next = [...load(channelId), msg].slice(-500);
  cache.set(channelId, next);
  try {
    localStorage.setItem(key(channelId), JSON.stringify(next));
  } catch {
    /* modo privado: fica só na memória */
  }
  emit();
}
