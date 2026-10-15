import { useState } from "react";
import {
  ChevronDown,
  Hash,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Settings,
  Signal,
  Video as VideoIcon,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { canShareScreen } from "@/call/Controls";
import type { Meeting } from "@/call/meeting";
import { useCall } from "@/call/useCall";
import { usePresence } from "@/chat/store";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { server, type Channel } from "./data";
import { Tip, soon } from "./ServerRail";
import type { Voice } from "./useVoice";

type Props = {
  me: string;
  selected: string;
  extraVoice?: Channel | null;
  voice: Voice;
  onSelect: (c: Channel) => void;
  onLogout: () => void;
};

/** Coluna dos canais (240px): nome do servidor, categorias, voz conectada e usuário. */
export function ChannelSidebar({ me, selected, extraVoice, voice, onSelect, onLogout }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const categories = server.categories.map((cat) =>
    cat.id === "voz" && extraVoice && !cat.channels.some((c) => c.id === extraVoice.id)
      ? { ...cat, channels: [...cat.channels, extraVoice] }
      : cat
  );

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-sidebar">
      <button
        type="button"
        onClick={soon}
        className="flex h-12 shrink-0 items-center justify-between border-b border-black/60 px-4 font-semibold shadow-[0_1px_0_rgb(255_255_255/0.03)] transition-colors hover:bg-white/4"
      >
        <span className="truncate">{server.name}</span>
        <ChevronDown className="size-4.5 text-muted-foreground" />
      </button>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pt-4 pb-2">
        {categories.map((cat) => {
          const closed = collapsed[cat.id];
          return (
            <section key={cat.id} className="mb-4">
              <button
                type="button"
                onClick={() => setCollapsed((s) => ({ ...s, [cat.id]: !s[cat.id] }))}
                className="flex w-full items-center gap-0.5 px-0.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
              >
                <ChevronDown className={cn("size-3 transition-transform", closed && "-rotate-90")} />
                {cat.name}
              </button>
              <ul className="flex flex-col gap-px">
                {cat.channels.map((ch) => {
                  const active = ch.id === selected;
                  const inHere = voice.state.status !== "idle" && voice.state.channel.id === ch.id;
                  // Categoria fechada ainda mostra o canal aberto e o de voz em que você está
                  if (closed && !active && !inHere) return null;
                  return (
                    <li key={ch.id}>
                      <ChannelRow channel={ch} active={active} onClick={() => onSelect(ch)} />
                      {inHere && voice.meeting ? (
                        <VoiceMembersLive meeting={voice.meeting} deafened={voice.deafened} />
                      ) : (
                        ch.kind === "voice" && <VoiceMembers channelId={ch.id} me={me} connecting={inHere} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="shrink-0 bg-panel">
        {voice.state.status !== "idle" && <VoiceConnected voice={voice} onOpen={onSelect} />}
        <UserPanel name={me} voice={voice} onLogout={onLogout} />
      </div>
    </aside>
  );
}

function ChannelRow({ channel, active, onClick }: { channel: Channel; active: boolean; onClick: () => void }) {
  const Icon = channel.kind === "text" ? Hash : Volume2;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/ch flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-[15px] font-medium transition-colors",
        active ? "bg-white/9 text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground/90"
      )}
    >
      <Icon className="size-5 shrink-0 opacity-70" />
      <span className="truncate">{channel.name}</span>
    </button>
  );
}

/** Quem está num canal de voz, pela presença do gateway (o seu, enquanto conecta, vem do RealtimeKit depois). */
function VoiceMembers({ channelId, me, connecting }: { channelId: string; me: string; connecting: boolean }) {
  const { voice } = usePresence();
  // A mesma pessoa em duas abas aparece uma vez só
  const here = new Map(voice.filter((v) => v.channelId === channelId).map((v) => [v.name, v]));
  const rows = [...here.values()];
  if (connecting && !here.has(me)) rows.push({ sessionId: "", name: me, channelId, selfMute: false, selfDeaf: false });
  if (!rows.length) return null;
  return (
    <ul className="flex flex-col gap-px py-0.5 pl-6">
      {rows.map((v) => (
        <li
          key={v.name}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground",
            connecting && v.name === me && "opacity-50"
          )}
        >
          <Avatar name={v.name} size={24} />
          <span className="min-w-0 flex-1 truncate">{v.name}</span>
          {v.selfDeaf ? (
            <HeadphoneOff className="size-4 shrink-0 text-destructive" />
          ) : (
            v.selfMute && <MicOff className="size-4 shrink-0 text-destructive" />
          )}
        </li>
      ))}
    </ul>
  );
}

function VoiceMembersLive({ meeting, deafened }: { meeting: Meeting; deafened: boolean }) {
  const { people, speaking } = useCall(meeting);
  return (
    <ul className="flex flex-col gap-px py-0.5 pl-6">
      {people.map((p) => (
        <li
          key={p.id}
          className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <Avatar name={p.name} size={24} speaking={p.id === speaking && p.audioEnabled} />
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          {p.screenEnabled && (
            <span className="rounded-sm bg-destructive px-1 text-[10px] font-bold text-white uppercase">Ao vivo</span>
          )}
          {p.videoEnabled && <VideoIcon className="size-4 shrink-0" />}
          {p.isSelf && deafened ? (
            <HeadphoneOff className="size-4 shrink-0 text-destructive" />
          ) : (
            !p.audioEnabled && <MicOff className="size-4 shrink-0 text-destructive" />
          )}
        </li>
      ))}
    </ul>
  );
}

function VoiceConnected({ voice, onOpen }: { voice: Voice; onOpen: (c: Channel) => void }) {
  if (voice.state.status === "idle") return null;
  const { channel } = voice.state;
  const connecting = voice.state.status === "connecting";
  return (
    <div className="border-b border-white/5 px-2 pt-2 pb-1.5">
      <div className="flex items-center gap-2 px-1">
        <Signal className={cn("size-4.5 shrink-0", connecting ? "text-warning" : "text-success")} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold", connecting ? "text-warning" : "text-success")}>
            {connecting ? "Conectando..." : "Voz conectada"}
          </p>
          <button
            type="button"
            onClick={() => onOpen(channel)}
            className="block max-w-full truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {channel.name} / {server.name}
          </button>
        </div>
        <Tip label="Desconectar">
          <button
            type="button"
            aria-label="Desconectar"
            onClick={() => void voice.leave()}
            className="flex size-8 items-center justify-center rounded-md text-foreground/80 hover:bg-white/6 hover:text-foreground"
          >
            <PhoneOff className="size-5" />
          </button>
        </Tip>
      </div>
      {voice.meeting && <ConnectedActions meeting={voice.meeting} />}
    </div>
  );
}

function ConnectedActions({ meeting }: { meeting: Meeting }) {
  const { me } = useCall(meeting);
  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/abort|cancel/i.test(msg)) toast.error("Não rolou", { description: msg });
  };
  const btn = "flex h-8 flex-1 items-center justify-center rounded-md transition-colors";
  return (
    <div className="mt-2 flex gap-2">
      <Tip label={me.videoEnabled ? "Desligar câmera" : "Ligar câmera"}>
        <button
          type="button"
          aria-label="Câmera"
          onClick={() => (me.videoEnabled ? meeting.self.disableVideo() : meeting.self.enableVideo()).catch(fail)}
          className={cn(btn, me.videoEnabled ? "bg-foreground text-background" : "bg-white/6 hover:bg-white/10")}
        >
          <VideoIcon className="size-4.5" />
        </button>
      </Tip>
      {canShareScreen && (
        <Tip label={me.screenEnabled ? "Parar de transmitir" : "Compartilhar tela"}>
          <button
            type="button"
            aria-label="Compartilhar tela"
            onClick={() =>
              (me.screenEnabled ? meeting.self.disableScreenShare() : meeting.self.enableScreenShare()).catch(fail)
            }
            className={cn(btn, me.screenEnabled ? "bg-foreground text-background" : "bg-white/6 hover:bg-white/10")}
          >
            <MonitorUp className="size-4.5" />
          </button>
        </Tip>
      )}
    </div>
  );
}

function UserPanel({ name, voice, onLogout }: { name: string; voice: Voice; onLogout: () => void }) {
  const micOff = voice.muted || voice.deafened;
  const icon = "flex size-8 items-center justify-center rounded-md transition-colors hover:bg-white/8";
  return (
    <div className="flex h-[52px] items-center gap-1 px-2">
      <button type="button" onClick={soon} className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-2 pl-0.5 text-left hover:bg-white/6">
        <Avatar name={name} size={32} status="online" ring="var(--mc-panel)" />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">Online</span>
        </span>
      </button>
      <Tip label={micOff ? "Ativar microfone" : "Desativar microfone"}>
        <button type="button" aria-label="Microfone" onClick={voice.toggleMute} className={cn(icon, micOff && "text-destructive")}>
          {micOff ? <MicOff className="size-5" /> : <Mic className="size-5" />}
        </button>
      </Tip>
      <Tip label={voice.deafened ? "Ativar áudio" : "Desativar áudio"}>
        <button type="button" aria-label="Áudio" onClick={voice.toggleDeafen} className={cn(icon, voice.deafened && "text-destructive")}>
          {voice.deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
        </button>
      </Tip>
      <Tip label="Trocar de nome">
        <button type="button" aria-label="Configurações" onClick={onLogout} className={icon}>
          <Settings className="size-5" />
        </button>
      </Tip>
    </div>
  );
}
