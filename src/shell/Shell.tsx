import { useEffect, useState } from "react";
import { isDm } from "@/chat/protocol";
import {
  connectChat,
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
import { ServerRail } from "./ServerRail";
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

  // Chat e presença: conecta no gateway com esse nome e avisa em qual voz você está
  useEffect(() => connectChat(name), [name]);
  const voiceChannelId = voice.state.status === "idle" ? null : voice.state.channel.id;
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

  return (
    <div className="flex h-full overflow-hidden bg-rail">
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
