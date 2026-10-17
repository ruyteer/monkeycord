import { useEffect, useState } from "react";
import {
  BellRing,
  Check,
  ChevronDown,
  CircleCheck,
  Hash,
  Headphones,
  HeadphoneOff,
  Link2,
  LogOut,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Plus,
  PlusCircle,
  Settings,
  Signal,
  Trash2,
  UserPen,
  Video as VideoIcon,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { canShareScreen } from "@/call/Controls";
import { usePrefs } from "@/call/devices";
import type { Meeting } from "@/call/meeting";
import { useCall } from "@/call/useCall";
import type { Status } from "@/chat/protocol";
import {
  closeDm,
  createChannel,
  deleteChannel,
  markRead,
  notifyLevel,
  setNotifyLevel,
  setStatus,
  unreadState,
  useChatVersion,
  useDms,
  useMyStatus,
  usePresence,
  type Dm,
  type NotifyLevel,
} from "@/chat/store";
import { cn } from "@/lib/utils";
import { Avatar, StatusDot, statusLabel } from "./Avatar";
import { categories, server, type Channel } from "./data";
import { Tip } from "./ServerRail";
import { ContextMenu, Menu, MenuItem, MenuLabel, MenuRadio, MenuSeparator, Modal, ModalButton, Popover } from "./ui";
import type { Voice } from "./useVoice";
import { openSettings } from "./Settings";
import { VoiceUserMenu } from "./VoiceUserMenu";

type Props = {
  me: string;
  mode: "server" | "home";
  selected: string;
  channels: Channel[];
  voice: Voice;
  onSelect: (c: Channel) => void;
  onSelectDm: (dm: Dm) => void;
  onOpenDm: (name: string) => void;
  onPrefetchVoice: (c: Channel) => void;
  onLogout: () => void;
};

/** Coluna dos canais (240px): servidor ou conversas diretas, voz conectada e usuário. */
export function ChannelSidebar(props: Props) {
  const { me, mode, voice, onSelect, onLogout } = props;
  return (
    <aside className="flex w-60 shrink-0 flex-col bg-sidebar">
      {mode === "server" ? <ServerChannels {...props} /> : <DmList {...props} />}
      <div className="shrink-0 bg-panel">
        {voice.state.status !== "idle" && <VoiceConnected voice={voice} onOpen={onSelect} />}
        <UserPanel name={me} voice={voice} onLogout={onLogout} />
      </div>
    </aside>
  );
}

function ServerChannels({ me, selected, channels, voice, onSelect, onPrefetchVoice, onOpenDm }: Props) {
  useChatVersion();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState<"text" | "voice" | null>(null);

  const invite = async () => {
    await navigator.clipboard?.writeText(location.origin).catch(() => {});
    toast.success("Link do MonkeyCord copiado, manda pra galera");
  };

  return (
    <>
      <Menu
        align="center"
        className="w-56"
        trigger={
          <button
            type="button"
            className="flex h-12 shrink-0 items-center justify-between border-b border-black/60 px-4 font-semibold shadow-[0_1px_0_rgb(255_255_255/0.03)] transition-colors hover:bg-white/4 data-[popup-open]:bg-white/6"
          >
            <span className="truncate">{server.name}</span>
            <ChevronDown className="size-4.5 text-muted-foreground" />
          </button>
        }
      >
        <MenuItem icon={<Link2 />} onClick={invite}>
          Convidar pessoas
        </MenuItem>
        <MenuItem icon={<PlusCircle />} onClick={() => setCreating("text")}>
          Criar canal
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<CircleCheck />}
          onClick={() => {
            channels.filter((c) => c.kind === "text").forEach((c) => markRead(c.id));
          }}
        >
          Marcar tudo como lido
        </MenuItem>
        <MenuItem
          icon={<BellRing />}
          onClick={() => {
            if (!("Notification" in window)) return toast("Este navegador não mostra notificações");
            void Notification.requestPermission().then((p) =>
              toast(p === "granted" ? "Notificações ligadas" : "O navegador bloqueou as notificações")
            );
          }}
        >
          Notificações da área de trabalho
        </MenuItem>
      </Menu>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pt-4 pb-2">
        {categories.map((cat) => {
          const closed = collapsed[cat.kind];
          const list = channels.filter((c) => c.kind === cat.kind).sort((a, b) => a.position - b.position);
          return (
            <section key={cat.kind} className="mb-4">
              <div className="group/cat flex items-center pr-1">
                <button
                  type="button"
                  onClick={() => setCollapsed((s) => ({ ...s, [cat.kind]: !s[cat.kind] }))}
                  className="flex flex-1 items-center gap-0.5 px-0.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
                >
                  <ChevronDown className={cn("size-3 transition-transform", closed && "-rotate-90")} />
                  {cat.name}
                </button>
                <Tip label="Criar canal">
                  <button
                    type="button"
                    aria-label="Criar canal"
                    onClick={() => setCreating(cat.kind)}
                    className="pb-1 text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="size-4" />
                  </button>
                </Tip>
              </div>
              <ul className="flex flex-col gap-px">
                {list.map((ch) => {
                  const active = ch.id === selected;
                  const inHere = voice.state.status !== "idle" && voice.state.channel.id === ch.id;
                  const { unread, mentions } = ch.kind === "text" ? unreadState(ch.id) : { unread: false, mentions: 0 };
                  // Categoria fechada ainda mostra o canal aberto, os não lidos e o de voz em que você está
                  if (closed && !active && !inHere && !unread) return null;
                  return (
                    <li key={ch.id}>
                      <ChannelRow
                        channel={ch}
                        active={active}
                        unread={unread}
                        mentions={mentions}
                        onClick={() => onSelect(ch)}
                        onPrefetch={() => ch.kind === "voice" && onPrefetchVoice(ch)}
                      />
                      {inHere && voice.meeting ? (
                        <VoiceMembersLive meeting={voice.meeting} deafened={voice.deafened} onOpenDm={onOpenDm} />
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

      <CreateChannel kind={creating} onClose={() => setCreating(null)} onCreated={onSelect} />
    </>
  );
}

function ChannelRow({
  channel,
  active,
  unread,
  mentions,
  onClick,
  onPrefetch,
}: {
  channel: Channel;
  active: boolean;
  unread: boolean;
  mentions: number;
  onClick: () => void;
  onPrefetch: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const Icon = channel.kind === "text" ? Hash : Volume2;
  const muted = channel.kind === "text" && notifyLevel(channel.id) === "none";

  const menu = (
    <>
      {channel.kind === "text" && (
        <>
          <MenuItem icon={<Check />} onClick={() => markRead(channel.id)}>
            Marcar como lido
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Notificações</MenuLabel>
          <MenuRadio<NotifyLevel>
            value={notifyLevel(channel.id)}
            onChange={(v) => setNotifyLevel(channel.id, v)}
            options={[
              { value: "all", label: "Todas as mensagens" },
              { value: "mentions", label: "Só @menções" },
              { value: "none", label: "Nada" },
            ]}
          />
          <MenuSeparator />
        </>
      )}
      <MenuItem icon={<Link2 />} onClick={() => copyChannelLink(channel)}>
        Copiar link
      </MenuItem>
      <MenuItem danger icon={<Trash2 />} onClick={() => setConfirm(true)}>
        Apagar canal
      </MenuItem>
    </>
  );

  return (
    <>
      <ContextMenu menu={menu}>
        <div
          className={cn(
            "group/ch relative flex h-8 w-full items-center rounded-md transition-colors",
            active ? "bg-white/9 text-foreground" : unread ? "text-foreground hover:bg-white/5" : "text-muted-foreground hover:bg-white/5 hover:text-foreground/90",
            muted && !active && "opacity-45"
          )}
        >
          {unread && !active && <span className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground" />}
          <button
            type="button"
            onClick={onClick}
            onPointerEnter={onPrefetch}
            onFocus={onPrefetch}
            className={cn("flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-[15px]", unread || active ? "font-semibold" : "font-medium")}
          >
            <Icon className="size-5 shrink-0 opacity-70" />
            <span className="truncate">{channel.name}</span>
          </button>
          {mentions > 0 && (
            <span className="mr-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-white">
              {mentions}
            </span>
          )}
          <Menu
            side="right"
            trigger={
              <button
                type="button"
                aria-label="Opções do canal"
                className="mr-1 hidden size-6 items-center justify-center rounded text-muted-foreground group-hover/ch:flex hover:text-foreground data-[popup-open]:flex"
              >
                <Settings className="size-4" />
              </button>
            }
          >
            {menu}
          </Menu>
        </div>
      </ContextMenu>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Apagar canal"
        description={
          <>
            Tem certeza que quer apagar <b>{channel.kind === "text" ? `#${channel.name}` : channel.name}</b>?
            {channel.kind === "text" && " Todas as mensagens dele somem junto e não dá pra desfazer."}
          </>
        }
        footer={
          <>
            <ModalButton variant="ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </ModalButton>
            <ModalButton
              variant="danger"
              onClick={() => {
                setConfirm(false);
                deleteChannel(channel.id).catch((e: Error) => toast.error("Não deu pra apagar", { description: e.message }));
              }}
            >
              Apagar canal
            </ModalButton>
          </>
        }
      />
    </>
  );
}

function copyChannelLink(channel: Channel) {
  const url =
    channel.kind === "voice"
      ? `${location.origin}/?sala=${encodeURIComponent(channel.room ?? channel.id)}`
      : `${location.origin}/?canal=${encodeURIComponent(channel.id)}`;
  void navigator.clipboard?.writeText(url).then(() => toast("Link copiado"));
}

function CreateChannel({
  kind,
  onClose,
  onCreated,
}: {
  kind: "text" | "voice" | null;
  onClose: () => void;
  onCreated: (c: Channel) => void;
}) {
  const [type, setType] = useState<"text" | "voice">("text");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastKind, setLastKind] = useState(kind);
  if (kind !== lastKind) {
    setLastKind(kind);
    if (kind) {
      setType(kind);
      setName("");
    }
  }

  const shown = type === "text" ? name.toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "") : name;

  const submit = async () => {
    if (!shown.trim()) return;
    setBusy(true);
    try {
      const ch = await createChannel(name, type);
      onClose();
      onCreated(ch);
    } catch (e) {
      toast.error("Não deu pra criar", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!kind}
      onOpenChange={(o) => !o && onClose()}
      title="Criar canal"
      footer={
        <>
          <ModalButton variant="ghost" onClick={onClose}>
            Cancelar
          </ModalButton>
          <ModalButton disabled={busy || !shown.trim()} onClick={submit}>
            Criar canal
          </ModalButton>
        </>
      }
    >
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Tipo de canal</p>
      <div className="flex flex-col gap-2">
        {(["text", "voice"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setType(k)}
            className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-left", type === k ? "bg-white/10" : "bg-white/4 hover:bg-white/7")}
          >
            {k === "text" ? <Hash className="size-6 text-muted-foreground" /> : <Volume2 className="size-6 text-muted-foreground" />}
            <span className="flex-1">
              <span className="block font-medium">{k === "text" ? "Texto" : "Voz"}</span>
              <span className="block text-xs text-muted-foreground">
                {k === "text" ? "Mensagens, imagens, emojis e opiniões" : "Conversar por voz, vídeo e compartilhar a tela"}
              </span>
            </span>
            <span className={cn("size-5 rounded-full border-2", type === k ? "border-[6px] border-foreground" : "border-white/30")} />
          </button>
        ))}
      </div>
      <p className="mt-4 mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Nome do canal</p>
      <label className="flex h-10 items-center gap-2 rounded-md bg-rail px-3">
        {type === "text" ? <Hash className="size-4 text-muted-foreground" /> : <Volume2 className="size-4 text-muted-foreground" />}
        <input
          autoFocus
          value={type === "text" ? shown : name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder={type === "text" ? "novo-canal" : "Novo canal"}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </label>
    </Modal>
  );
}

/** Tela inicial: conversas diretas e quem está online pra começar uma. */
function DmList({ me, selected, onSelectDm, onOpenDm }: Props) {
  useChatVersion();
  const dms = useDms();
  const { statuses } = usePresence();
  const [q, setQ] = useState("");
  const others = Object.keys(statuses).filter((n) => n !== me && !dms.some((d) => d.with === n));
  const match = (n: string) => n.toLowerCase().includes(q.trim().toLowerCase());

  return (
    <>
      <div className="flex h-12 shrink-0 items-center border-b border-black/60 px-2.5 shadow-[0_1px_0_rgb(255_255_255/0.03)]">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim() && q.trim() !== me) {
              onOpenDm(q.trim());
              setQ("");
            }
          }}
          placeholder="Encontre ou comece uma conversa"
          className="h-7 w-full rounded-md bg-rail px-2 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pt-3 pb-2">
        <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Mensagens diretas</p>
        <ul className="flex flex-col gap-px">
          {dms.filter((d) => match(d.with)).map((d) => {
            const { unread, mentions } = unreadState(d.id);
            const active = d.id === selected;
            return (
              <li
                key={d.id}
                className={cn(
                  "group/dm flex h-11 items-center rounded-md pr-1",
                  active ? "bg-white/9 text-foreground" : unread ? "text-foreground hover:bg-white/5" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                <button type="button" onClick={() => onSelectDm(d)} className="flex h-full min-w-0 flex-1 items-center gap-3 px-2">
                  <Avatar name={d.with} size={32} status={statuses[d.with] ?? "offline"} />
                  <span className={cn("truncate", unread && "font-semibold")}>{d.with}</span>
                </button>
                {mentions > 0 && (
                  <span className="mr-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-white">
                    {mentions}
                  </span>
                )}
                <button
                  type="button"
                  aria-label="Fechar conversa"
                  onClick={() => closeDm(d.id)}
                  className="hidden size-6 items-center justify-center text-muted-foreground group-hover/dm:flex hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
        {!dms.length && <p className="px-2 py-2 text-sm text-muted-foreground">Nenhuma conversa ainda.</p>}

        {!!others.filter(match).length && (
          <>
            <p className="mt-4 px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Online agora</p>
            <ul className="flex flex-col gap-px">
              {others.filter(match).map((n) => (
                <li key={n}>
                  <button
                    type="button"
                    onClick={() => onOpenDm(n)}
                    className="flex h-11 w-full items-center gap-3 rounded-md px-2 text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  >
                    <Avatar name={n} size={32} status={statuses[n]} />
                    <span className="truncate">{n}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
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

function VoiceMembersLive({ meeting, deafened, onOpenDm }: { meeting: Meeting; deafened: boolean; onOpenDm: (name: string) => void }) {
  const { people, speaking } = useCall(meeting);
  const { voice } = usePresence();
  const prefs = usePrefs();
  return (
    <ul className="flex flex-col gap-px py-0.5 pl-6">
      {people.map((p) => {
        const deaf = p.isSelf ? deafened : !!voice.find((v) => v.sessionId === p.id)?.selfDeaf;
        return (
          <VoiceUserMenu key={p.id} name={p.name} isSelf={p.isSelf} onOpenDm={onOpenDm}>
            <li className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground">
              <Avatar name={p.name} size={24} speaking={p.id === speaking && p.audioEnabled} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.screenEnabled && (
                <span className="rounded-sm bg-destructive px-1 text-[10px] font-bold text-white uppercase">Ao vivo</span>
              )}
              {p.videoEnabled && <VideoIcon className="size-4 shrink-0" />}
              {!p.isSelf && prefs.localMute[p.name] && <VolumeX className="size-4 shrink-0 text-destructive" />}
              {deaf ? (
                <HeadphoneOff className="size-4 shrink-0 text-destructive" />
              ) : (
                !p.audioEnabled && <MicOff className="size-4 shrink-0 text-destructive" />
              )}
            </li>
          </VoiceUserMenu>
        );
      })}
    </ul>
  );
}

/** Ping até a pessoa mais lenta da chamada, atualizado a cada 3s. */
type ConnStats = Awaited<ReturnType<Meeting["stats"]>>;

function usePing(meeting: Meeting | null) {
  const [ping, setPing] = useState<{ ms?: number; bad: boolean; list: ConnStats } | null>(null);
  useEffect(() => {
    if (!meeting) return setPing(null);
    const tick = async () => {
      const list = await meeting.stats();
      const rtts = list.map((s) => s.rtt).filter((x): x is number => x != null);
      setPing({
        ms: rtts.length ? Math.round(Math.max(...rtts)) : undefined,
        bad: list.some((s) => s.state !== "connected"),
        list,
      });
    };
    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => window.clearInterval(id);
  }, [meeting]);
  return ping;
}

/** Conexão com cada pessoa da chamada (clique em "Voz conectada"). */
function ConnectionDetails({ list }: { list: ConnStats }) {
  const label: Record<string, string> = {
    new: "começando",
    connecting: "conectando",
    connected: "conectado",
    disconnected: "caiu, voltando",
    failed: "não conectou",
    closed: "fechado",
  };
  return (
    <div>
      <p className="mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">Conexão de voz</p>
      {!list.length && <p className="text-sm text-muted-foreground">Só você no canal.</p>}
      <ul className="flex flex-col gap-2">
        {list.map((s) => (
          <li key={s.id} className="rounded-md bg-white/5 px-2.5 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{s.name}</span>
              <span className={cn("shrink-0 text-xs font-semibold", s.state === "connected" ? "text-success" : "text-warning")}>
                {label[s.state] ?? s.state}
              </span>
            </div>
            {s.state === "connected" && (
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {s.rtt != null && `${Math.round(s.rtt)} ms · `}
                {s.route === "turn" ? "via servidor TURN" : "direto"}
                {s.inKbps > 50 && ` · recebendo ${(s.inKbps / 1000).toFixed(1)} Mbps`}
                {s.outKbps > 50 && ` · enviando ${(s.outKbps / 1000).toFixed(1)} Mbps`}
              </p>
            )}
          </li>
        ))}
      </ul>
      {list.some((s) => s.state === "failed" || s.state === "connecting" || s.state === "new") && (
        <p className="mt-2 text-xs text-muted-foreground">
          Se alguém ficar em “conectando” por mais de 15 segundos, a rede de vocês não deixa ligar direto: precisa de um servidor TURN (veja o README).
        </p>
      )}
    </div>
  );
}

function VoiceConnected({ voice, onOpen }: { voice: Voice; onOpen: (c: Channel) => void }) {
  const ping = usePing(voice.meeting);
  if (voice.state.status === "idle") return null;
  const { channel } = voice.state;
  const connecting = voice.state.status === "connecting";
  return (
    <div className="border-b border-white/5 px-2 pt-2 pb-1.5">
      <div className="flex items-center gap-2 px-1">
        <Signal className={cn("size-4.5 shrink-0", connecting ? "text-warning" : "text-success")} />
        <div className="min-w-0 flex-1">
          <Popover
            side="top"
            align="start"
            className="w-72 p-3"
            trigger={
              <button
                type="button"
                className={cn("text-left text-sm font-semibold hover:underline", connecting ? "text-warning" : ping?.bad ? "text-warning" : "text-success")}
              >
                {connecting ? "Conectando..." : ping?.bad ? "Conectando com alguém..." : "Voz conectada"}
                {!connecting && ping?.ms != null && (
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground tabular-nums">{ping.ms} ms</span>
                )}
              </button>
            }
          >
            <ConnectionDetails list={ping?.list ?? []} />
          </Popover>
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

const STATUS_OPTIONS: { value: Status; hint?: string }[] = [
  { value: "online" },
  { value: "idle" },
  { value: "dnd", hint: "Você não vai receber notificações" },
  { value: "invisible", hint: "Você aparece offline, mas pode usar tudo normalmente" },
];

function UserPanel({ name, voice, onLogout }: { name: string; voice: Voice; onLogout: () => void }) {
  const status = useMyStatus();
  const [open, setOpen] = useState(false);
  const micOff = voice.muted || voice.deafened;
  const icon = "flex size-8 items-center justify-center rounded-md transition-colors hover:bg-white/8";
  return (
    <div className="flex h-[52px] items-center gap-1 px-2">
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="start"
        className="w-[280px] p-2"
        trigger={
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-2 pl-0.5 text-left hover:bg-white/6">
            <Avatar name={name} size={32} status={status === "invisible" ? "offline" : status} ring="var(--mc-panel)" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{statusLabel[status]}</span>
            </span>
          </button>
        }
      >
        <div className="flex items-center gap-3 px-2 pt-1 pb-3">
          <Avatar name={name} size={48} />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{name}</p>
            <p className="text-xs text-muted-foreground">{statusLabel[status]}</p>
          </div>
        </div>
        <ul className="flex flex-col gap-px border-t border-white/8 pt-2">
          {STATUS_OPTIONS.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                onClick={() => {
                  setStatus(o.value);
                  setOpen(false);
                }}
                className={cn("flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left hover:bg-white/8", status === o.value && "bg-white/6")}
              >
                <StatusDot status={o.value} size={12} className="mt-1" ring="var(--popover)" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{statusLabel[o.value]}</span>
                  {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Popover>
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
      <Menu
        side="top"
        align="end"
        trigger={
          <button type="button" aria-label="Configurações" className={icon}>
            <Settings className="size-5" />
          </button>
        }
      >
        <MenuItem icon={<Settings />} onClick={() => openSettings("conta")}>
          Configurações de usuário
        </MenuItem>
        <MenuItem icon={<Mic />} onClick={() => openSettings("voz")}>
          Voz e vídeo
        </MenuItem>
        <MenuItem icon={<UserPen />} onClick={onLogout}>
          Trocar de nome
        </MenuItem>
        <MenuItem
          icon={<BellRing />}
          onClick={() => {
            if (!("Notification" in window)) return toast("Este navegador não mostra notificações");
            void Notification.requestPermission().then((p) =>
              toast(p === "granted" ? "Notificações ligadas" : "O navegador bloqueou as notificações")
            );
          }}
        >
          Notificações da área de trabalho
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger icon={<LogOut />} onClick={onLogout}>
          Sair
        </MenuItem>
      </Menu>
    </div>
  );
}
