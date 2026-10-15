import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bell, Gift, Hash, Menu, Pin, PlusCircle, Search, Smile, Sticker, Users } from "lucide-react";
import { sendMessage, useMessages, type Message } from "@/chat/store";
import { cn } from "@/lib/utils";
import { Avatar, nameColor } from "./Avatar";
import type { Channel } from "./data";
import { Tip, soon } from "./ServerRail";

/** Barra de 48px do topo do canal. */
export function ChannelHeader({
  icon,
  title,
  topic,
  onMenu,
  actions,
}: {
  icon: ReactNode;
  title: string;
  topic?: string;
  onMenu: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/50 px-2 shadow-[0_1px_0_rgb(255_255_255/0.03)] sm:px-4">
      <button
        type="button"
        aria-label="Abrir canais"
        onClick={onMenu}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-white/6 hover:text-foreground md:hidden"
      >
        <Menu className="size-5" />
      </button>
      <span className="text-muted-foreground">{icon}</span>
      <h1 className="truncate font-semibold">{title}</h1>
      {topic && (
        <>
          <span className="mx-1 h-6 w-px shrink-0 bg-white/10 max-lg:hidden" />
          <p className="min-w-0 truncate text-sm text-muted-foreground max-lg:hidden">{topic}</p>
        </>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">{actions}</div>
    </header>
  );
}

export function HeaderIcon({ label, active, onClick, children }: { label: string; active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <Tip label={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick ?? soon}
        className={cn("flex size-8 items-center justify-center rounded-md hover:text-foreground", active && "text-foreground")}
      >
        {children}
      </button>
    </Tip>
  );
}

type Props = {
  channel: Channel;
  me: string;
  showMembers: boolean;
  onToggleMembers: () => void;
  onMenu: () => void;
};

export function TextChannel({ channel, me, showMembers, onToggleMembers, onMenu }: Props) {
  const messages = useMessages(channel.id);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-main">
      <ChannelHeader
        icon={<Hash className="size-6" />}
        title={channel.name}
        topic={channel.topic}
        onMenu={onMenu}
        actions={
          <>
            <span className="contents max-sm:hidden">
              <HeaderIcon label="Notificações">
                <Bell className="size-5" />
              </HeaderIcon>
              <HeaderIcon label="Mensagens fixadas">
                <Pin className="size-5" />
              </HeaderIcon>
            </span>
            <HeaderIcon label={showMembers ? "Ocultar lista de membros" : "Mostrar lista de membros"} active={showMembers} onClick={onToggleMembers}>
              <Users className="size-5" />
            </HeaderIcon>
            <button
              type="button"
              onClick={soon}
              className="ml-1 flex h-6 w-36 items-center justify-between rounded-md bg-rail px-1.5 text-xs text-muted-foreground max-md:hidden"
            >
              Buscar
              <Search className="size-3.5" />
            </button>
          </>
        }
      />
      <MessageList channel={channel} messages={messages} />
      <Composer channel={channel} me={me} />
    </div>
  );
}

/** Mensagens do mesmo autor com menos de 7 min de diferença viram um grupo (só o primeiro tem avatar). */
const GROUP_MS = 7 * 60 * 1000;

function MessageList({ channel, messages }: { channel: Channel; messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Fica grudado no fim enquanto você não rolar pra cima
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  useEffect(() => {
    stick.current = true;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [channel.id]);

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="mt-auto px-4 pt-6 pb-4">
        <div className="flex size-17 items-center justify-center rounded-full bg-white/8">
          <Hash className="size-10" />
        </div>
        <h2 className="mt-2 text-3xl font-bold">Boas-vindas a #{channel.name}!</h2>
        <p className="mt-1 text-muted-foreground">
          Este é o começo do canal #{channel.name}.
        </p>
      </div>

      <ol className="pb-6">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || !sameDay(prev.ts, m.ts);
          const head = newDay || prev.author !== m.author || m.ts - prev.ts > GROUP_MS;
          return (
            <Fragment key={m.id}>
              {newDay && <DayDivider ts={m.ts} />}
              <MessageRow message={m} head={head} />
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}

function DayDivider({ ts }: { ts: number }) {
  return (
    <li className="mx-4 my-2 flex items-center gap-2" role="separator">
      <span className="h-px flex-1 bg-white/8" />
      <span className="text-xs font-semibold text-muted-foreground">
        {new Date(ts).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })}
      </span>
      <span className="h-px flex-1 bg-white/8" />
    </li>
  );
}

function MessageRow({ message: m, head }: { message: Message; head: boolean }) {
  const time = new Date(m.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <li className={cn("group/msg relative py-0.5 pr-12 pl-[72px] hover:bg-black/15", head && "mt-4")}>
      {head ? (
        <>
          <Avatar name={m.author} size={40} className="absolute top-1 left-4" />
          <div className="flex items-baseline gap-2">
            <span className="font-medium hover:underline" style={{ color: nameColor(m.author) }}>
              {m.author}
            </span>
            <time className="text-xs text-muted-foreground">{fullTime(m.ts)}</time>
          </div>
        </>
      ) : (
        <time className="absolute top-1 left-0 w-[72px] text-center text-[11px] leading-5 text-muted-foreground opacity-0 group-hover/msg:opacity-100">
          {time}
        </time>
      )}
      <p
        className={cn(
          "leading-[1.375rem] break-words whitespace-pre-wrap text-foreground/90",
          m.pending && "text-muted-foreground",
          m.failed && "text-destructive"
        )}
      >
        {m.content}
      </p>
    </li>
  );
}

function Composer({ channel, me }: { channel: Channel; me: string }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Cresce com o texto até ~50% da tela, igual ao Discord
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.5)}px`;
  }, [text]);
  useEffect(() => ref.current?.focus(), [channel.id]);

  const send = () => {
    sendMessage(channel.id, me, text);
    setText("");
  };

  return (
    <div className="shrink-0 px-4 pb-6">
      <div className="flex items-start rounded-lg bg-field">
        <ComposerIcon label="Enviar arquivo">
          <PlusCircle className="size-6" />
        </ComposerIcon>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          maxLength={2000}
          placeholder={`Conversar em #${channel.name}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="scrollbar-thin min-w-0 flex-1 resize-none bg-transparent py-[11px] leading-[1.375rem] outline-none placeholder:text-muted-foreground/70"
        />
        <div className="flex shrink-0 items-center">
          <span className="contents max-sm:hidden">
            <ComposerIcon label="Presentear">
              <Gift className="size-6" />
            </ComposerIcon>
            <ComposerIcon label="Figurinhas">
              <Sticker className="size-6" />
            </ComposerIcon>
          </span>
          <ComposerIcon label="Emoji">
            <Smile className="size-6" />
          </ComposerIcon>
        </div>
      </div>
    </div>
  );
}

function ComposerIcon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={soon}
        className="flex h-11 w-10 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {children}
      </button>
    </Tip>
  );
}

function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function fullTime(ts: number) {
  const d = new Date(ts);
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return `Hoje às ${hm}`;
  if (d.toDateString() === yesterday.toDateString()) return `Ontem às ${hm}`;
  return `${d.toLocaleDateString("pt-BR")} ${hm}`;
}
