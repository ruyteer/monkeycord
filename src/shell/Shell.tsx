import { useEffect, useRef, useState } from "react";
import { badgeImage, desktop } from "@/desktop";
import { isDm } from "@/chat/protocol";
import {
  connectChat,
  markRead,
  unreadState,
  useChatVersion,
  onOpenChannel,
  openDm,
  preloadChannels,
  setActiveChannel,
  updateVoiceState,
  useChannels,
  useDms,
  usePresence,
  type Dm,
} from "@/chat/store";
import { cn } from "@/lib/utils";
import { CallAudio } from "./CallAudio";
import { ChannelSidebar } from "./ChannelSidebar";
import { voiceChannelForRoom, type Channel } from "./data";
import { MemberList } from "./MemberList";
import { QuickSwitcher } from "./QuickSwitcher";
import { ServerRail } from "./ServerRail";
import { openSettings, SettingsHost } from "./Settings";
import { TextChannel, type TextView } from "./TextChannel";
import { useVoice } from "./useVoice";
import { VoiceStage } from "./VoiceStage";

type Props = {
  name: string;
  /** Veio por link de convite (?sala=): já entra na voz dessa sala */
  inviteRoom?: string;
  onLogout: () => void;
};

type Place = { mode: "server" | "home"; id: string | null };

/**
 * Layout estilo Discord:
 * servidores (72) | canais ou conversas (240) | chat ou chamada | membros (240)
 * No celular, servidores + canais viram uma gaveta.
 */
export function Shell({ name, inviteRoom, onLogout }: Props) {
  const voice = useVoice(name);
  const channels = useChannels();
  const dms = useDms();
  const presence = usePresence();
  const [extraVoice] = useState(() => (inviteRoom ? voiceChannelForRoom(inviteRoom, channels) : null));
  const [place, setPlace] = useState<Place>(() => {
    const canal = new URLSearchParams(location.search).get("canal");
    if (extraVoice) return { mode: "server", id: extraVoice.id };
    if (canal) return { mode: "server", id: canal };
    return { mode: "server", id: safeGet("mc:canal") };
  });
  const [lastDm, setLastDm] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [switcher, setSwitcher] = useState(false);

  // Chat e presença: conecta no gateway com esse nome e avisa em qual voz você está
  useEffect(() => connectChat(name), [name]);
  // Só avisa que entrou depois de a chamada estar pronta pra receber as conexões dos outros
  const voiceChannelId = voice.state.status === "connected" ? voice.state.channel.id : null;
  useEffect(() => {
    updateVoiceState(voiceChannelId, voice.muted, voice.deafened);
  }, [voiceChannelId, voice.muted, voice.deafened]);
  // Depois do READY: histórico de todos os canais, pra marcar o que está sem ler
  useEffect(() => {
    if (presence.status === "ready") preloadChannels();
  }, [presence.status]);

  const allChannels = extraVoice && !channels.some((c) => c.id === extraVoice.id) ? [...channels, extraVoice] : channels;
  const firstText = allChannels.find((c) => c.kind === "text");
  const serverChannel = allChannels.find((c) => c.id === place.id) ?? firstText ?? allChannels[0];
  const dm = place.mode === "home" ? dms.find((d) => d.id === place.id) ?? null : null;

  const view: TextView | null =
    place.mode === "home"
      ? dm && { id: dm.id, name: dm.with, dmWith: dm.with }
      : serverChannel.kind === "text"
        ? { id: serverChannel.id, name: serverChannel.name, topic: serverChannel.topic }
        : null;

  // Canal aberto: marca como lido e não notifica
  const activeId = view?.id ?? null;
  useEffect(() => {
    setActiveChannel(activeId);
    const back = () => !document.hidden && activeId && setActiveChannel(activeId);
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [activeId]);

  // Link de convite: entra direto
  useEffect(() => {
    if (extraVoice) void voice.join(extraVoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (c: Channel) => {
    setPlace({ mode: "server", id: c.id });
    setDrawer(false);
    if (channels.some((x) => x.id === c.id)) safeSet("mc:canal", c.id);
    if (c.kind === "voice") {
      void voice.join(c);
      history.replaceState(null, "", "?sala=" + encodeURIComponent(c.room ?? c.id));
    } else history.replaceState(null, "", location.pathname);
  };

  const selectDm = (d: Dm) => {
    setPlace({ mode: "home", id: d.id });
    setLastDm(d.id);
    setDrawer(false);
    history.replaceState(null, "", location.pathname);
  };

  const startDm = (other: string) => selectDm(openDm(other));

  // Clique numa notificação
  useEffect(
    () =>
      onOpenChannel((id) => {
        if (isDm(id)) {
          const d = dms.find((x) => x.id === id);
          if (d) selectDm(d);
        } else {
          const c = channels.find((x) => x.id === id);
          if (c) select(c);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dms, channels]
  );

  const logout = async () => {
    await voice.leave();
    onLogout();
  };

  const openMenu = () => setDrawer(true);

  // Lista na ordem da barra lateral, pra Alt+↑/↓
  const ordered = [...allChannels].sort((a, b) => (a.kind === b.kind ? a.position - b.position : a.kind === "text" ? -1 : 1));

  // Atalhos de teclado (os de mutar também chegam do app desktop com ele minimizado)
  const latest = useRef({ voice, ordered, serverChannel, view, place });
  latest.current = { voice, ordered, serverChannel, view, place };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { voice, ordered, serverChannel, view, place } = latest.current;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcher((o) => !o);
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        voice.toggleMute();
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        voice.toggleDeafen();
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && place.mode === "server") {
        e.preventDefault();
        const i = ordered.findIndex((c) => c.id === serverChannel.id);
        const next = ordered[(i + (e.key === "ArrowDown" ? 1 : -1) + ordered.length) % ordered.length];
        // Alt+setas só passeia pelos canais de texto (não entra em voz sem querer)
        if (next.kind === "text") select(next);
        else setPlace({ mode: "server", id: next.id });
      } else if (e.key === "Escape" && view && !document.querySelector("[role=dialog]")) {
        markRead(view.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // App desktop: bandeja, atalhos globais, links monkeycord:// e selo na barra de tarefas
  useEffect(
    () =>
      desktop?.onCommand((cmd) => {
        const { voice } = latest.current;
        if (cmd === "toggleMute") voice.toggleMute();
        else if (cmd === "toggleDeafen") voice.toggleDeafen();
        else if (cmd === "disconnect") void voice.leave();
        else if (cmd === "openSettings") openSettings("conta");
        else if (cmd.startsWith("open:")) select(voiceChannelForRoom(cmd.slice(5), latest.current.ordered));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useEffect(() => {
    desktop?.setVoiceState({ inVoice: voice.state.status !== "idle", muted: voice.muted, deafened: voice.deafened });
  }, [voice.state.status, voice.muted, voice.deafened]);
  useChatVersion();
  const mentionCount = [...channels.filter((c) => c.kind === "text").map((c) => c.id), ...dms.map((d) => d.id)].reduce(
    (n, id) => n + unreadState(id).mentions,
    0
  );
  const anyUnread = channels.some((c) => c.kind === "text" && unreadState(c.id).unread) || dms.some((d) => unreadState(d.id).unread);
  const prevMentions = useRef(0);
  useEffect(() => {
    if (!desktop) return;
    desktop.setBadge(mentionCount, anyUnread, mentionCount ? badgeImage(mentionCount) : null);
    if (mentionCount > prevMentions.current && !document.hasFocus()) desktop.flash();
    prevMentions.current = mentionCount;
  }, [mentionCount, anyUnread]);
  // No navegador: (2) no título da aba
  useEffect(() => {
    if (desktop) return;
    document.title = mentionCount ? `(${mentionCount}) MonkeyCord` : anyUnread ? "• MonkeyCord" : "MonkeyCord";
  }, [mentionCount, anyUnread]);

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-rail">
      {/* Fundo escuro da gaveta no celular */}
      <div
        onClick={() => setDrawer(false)}
        className={cn(
          "fixed inset-0 z-30 bg-black/60 transition-opacity md:hidden",
          drawer ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <div
        className={cn(
          "safe-top flex shrink-0 bg-rail transition-transform duration-200 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40",
          !drawer && "max-md:-translate-x-full"
        )}
      >
        <ServerRail
          mode={place.mode}
          channels={channels}
          onHome={() => {
            const d = dms.find((x) => x.id === lastDm) ?? dms[0];
            setPlace({ mode: "home", id: d?.id ?? null });
          }}
          onServer={() => setPlace({ mode: "server", id: safeGet("mc:canal") })}
          onSelectDm={selectDm}
        />
        <ChannelSidebar
          me={name}
          mode={place.mode}
          selected={place.mode === "home" ? (dm?.id ?? "") : serverChannel.id}
          channels={allChannels}
          voice={voice}
          onSelect={select}
          onSelectDm={selectDm}
          onOpenDm={startDm}
          onPrefetchVoice={voice.prefetch}
          onLogout={logout}
        />
      </div>

      <main className="safe-top flex min-w-0 flex-1 bg-main">
        {view ? (
          <TextChannel
            view={view}
            me={name}
            showMembers={showMembers}
            onToggleMembers={() => setShowMembers((s) => !s)}
            onMenu={openMenu}
            onOpenDm={startDm}
            aside={showMembers && !view.dmWith ? <MemberList me={name} meeting={voice.meeting} onOpenDm={startDm} /> : undefined}
          />
        ) : place.mode === "home" ? (
          <HomeEmpty onMenu={openMenu} />
        ) : (
          <VoiceStage channel={serverChannel} voice={voice} onMenu={openMenu} />
        )}
      </main>

      {voice.meeting && <CallAudio meeting={voice.meeting} deafened={voice.deafened} />}
      <QuickSwitcher
        open={switcher}
        onOpenChange={setSwitcher}
        me={name}
        channels={ordered}
        onChannel={select}
        onPerson={startDm}
      />
      <SettingsHost name={name} meeting={voice.meeting} onLogout={() => void logout()} />
    </div>
  );
}

function HomeEmpty({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <button type="button" onClick={onMenu} className="absolute top-3 left-3 rounded-md px-2 py-1 text-sm text-muted-foreground md:hidden">
        ☰ Conversas
      </button>
      <p className="font-display text-5xl text-muted-foreground/60">MonkeyCord</p>
      <p className="max-w-sm text-muted-foreground">
        Nenhuma conversa aberta. Clique em alguém da lista, ou no nome de quem mandou uma mensagem, e use “Enviar mensagem”.
      </p>
    </div>
  );
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
