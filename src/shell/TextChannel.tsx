import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bell, BellOff, Hash, Loader2, Menu as MenuIcon, Pin, Search, Upload, Users, X } from "lucide-react";
import {
  fetchPins,
  loadOlder,
  notifyLevel,
  searchMessages,
  setNotifyLevel,
  useChatVersion,
  useMessages,
  usePresence,
  type Message,
  type NotifyLevel,
} from "@/chat/store";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { jumpTo, MessageRow } from "./Message";
import { Tip } from "./ServerRail";
import { Menu, MenuLabel, MenuRadio, Popover } from "./ui";

/** Canal de texto do servidor ou conversa direta (dmWith = com quem). */
export type TextView = { id: string; name: string; topic?: string; dmWith?: string };

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
        <MenuIcon className="size-5" />
      </button>
      <span className="text-muted-foreground">{icon}</span>
      <h1 className="max-w-[50%] shrink-0 truncate font-semibold">{title}</h1>
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
        onClick={onClick}
        className={cn("flex size-8 items-center justify-center rounded-md hover:text-foreground", active && "text-foreground")}
      >
        {children}
      </button>
    </Tip>
  );
}

type Props = {
  view: TextView;
  me: string;
  showMembers: boolean;
  onToggleMembers: () => void;
  onMenu: () => void;
  onOpenDm: (name: string) => void;
  /** Lista de membros (some quando a busca está aberta) */
  aside?: ReactNode;
};

export function TextChannel({ view, me, showMembers, onToggleMembers, onMenu, onOpenDm, aside }: Props) {
  const messages = useMessages(view.id);
  const { statuses } = usePresence();
  const [editing, setEditing] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState<string | null>(null);
  const [dropped, setDropped] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setEditing(null);
    setReplyTo(null);
    setSearching(null);
    setQuery("");
  }, [view.id]);

  const names = [...new Set([...Object.keys(statuses), ...messages.map((m) => m.author)])].sort((a, b) => a.localeCompare(b));
  const title = view.dmWith ?? view.name;

  return (
    <div className="flex min-w-0 flex-1">
      <div
        className="relative flex min-w-0 flex-1 flex-col bg-main"
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes("Files")) setDragging(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) setDropped([...e.dataTransfer.files]);
        }}
      >
        <ChannelHeader
          icon={view.dmWith ? <Avatar name={view.dmWith} size={24} status={statuses[view.dmWith] ?? "offline"} ring="var(--mc-main)" /> : <Hash className="size-6" />}
          title={title}
          topic={view.topic}
          onMenu={onMenu}
          actions={
            <>
              <NotifyMenu channelId={view.id} />
              <PinsButton view={view} me={me} onOpenDm={onOpenDm} />
              {!view.dmWith && (
                <HeaderIcon label={showMembers ? "Ocultar lista de membros" : "Mostrar lista de membros"} active={showMembers} onClick={onToggleMembers}>
                  <Users className="size-5" />
                </HeaderIcon>
              )}
              <form
                className="ml-1 flex h-6 w-36 items-center rounded-md bg-rail px-1.5 text-xs transition-[width] focus-within:w-56 max-md:hidden"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (query.trim()) setSearching(query.trim());
                }}
              >
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar"
                  className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                />
                {searching ? (
                  <button
                    type="button"
                    aria-label="Fechar busca"
                    onClick={() => {
                      setSearching(null);
                      setQuery("");
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : (
                  <Search className="size-3.5" />
                )}
              </form>
            </>
          }
        />
        <MessageList
          view={view}
          me={me}
          messages={messages}
          editing={editing}
          setEditing={setEditing}
          onReply={setReplyTo}
          onOpenDm={onOpenDm}
        />
        <Composer
          channelId={view.id}
          placeholder={view.dmWith ? `Conversar com @${view.dmWith}` : `Conversar em #${view.name}`}
          me={me}
          names={names}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onEditLast={() => {
            const last = [...messages].reverse().find((m) => m.author === me && !m.pending && !m.failed);
            if (last) setEditing(last.id);
          }}
          dropped={dropped}
          onDroppedTaken={() => setDropped(null)}
        />

        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-8">
            <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-white/30 bg-elevated px-10 py-8 text-center">
              <Upload className="size-10" />
              <p className="text-lg font-bold">Enviar para {view.dmWith ? `@${view.dmWith}` : `#${view.name}`}</p>
              <p className="text-sm text-muted-foreground">Até 2 MB por arquivo. Imagens grandes são reduzidas.</p>
            </div>
          </div>
        )}
      </div>

      {searching ? (
        <SearchPanel view={view} query={searching} me={me} onOpenDm={onOpenDm} onClose={() => setSearching(null)} />
      ) : (
        aside
      )}
    </div>
  );
}

/** Mensagens do mesmo autor com menos de 7 min de diferença viram um grupo (só o primeiro tem avatar). */
const GROUP_MS = 7 * 60 * 1000;

function MessageList({
  view,
  me,
  messages,
  editing,
  setEditing,
  onReply,
  onOpenDm,
}: {
  view: TextView;
  me: string;
  messages: Message[];
  editing: string | null;
  setEditing: (id: string | null) => void;
  onReply: (m: Message) => void;
  onOpenDm: (name: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [older, setOlder] = useState<"idle" | "loading" | "end">("idle");
  const keep = useRef<number | null>(null);

  // Fica grudado no fim enquanto você não rolar pra cima; ao carregar antigas, mantém a posição
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (keep.current != null) {
      el.scrollTop = el.scrollHeight - keep.current;
      keep.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  useEffect(() => {
    stick.current = true;
    setOlder("idle");
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.id]);

  const loadMore = () => {
    if (older !== "idle" || messages.length < 50) return;
    const el = ref.current!;
    setOlder("loading");
    keep.current = el.scrollHeight - el.scrollTop;
    loadOlder(view.id).then((n) => {
      if (!n) keep.current = null;
      setOlder(n ? "idle" : "end");
    });
  };

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        if (el.scrollTop < 300) loadMore();
      }}
      className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      {older === "loading" && (
        <div className="flex justify-center py-3">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {(older === "end" || messages.length < 50) && (
        <div className="mt-auto px-4 pt-6 pb-4">
          {view.dmWith ? (
            <>
              <Avatar name={view.dmWith} size={80} />
              <h2 className="mt-2 text-3xl font-bold">{view.dmWith}</h2>
              <p className="mt-1 text-muted-foreground">
                Este é o começo do seu histórico de mensagens diretas com <b>{view.dmWith}</b>.
              </p>
            </>
          ) : (
            <>
              <div className="flex size-17 items-center justify-center rounded-full bg-white/8">
                <Hash className="size-10" />
              </div>
              <h2 className="mt-2 text-3xl font-bold">Boas-vindas a #{view.name}!</h2>
              <p className="mt-1 text-muted-foreground">Este é o começo do canal #{view.name}.</p>
            </>
          )}
        </div>
      )}

      <ol className={cn("pb-6", older !== "end" && messages.length >= 50 && "mt-auto")}>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || !sameDay(prev.ts, m.ts);
          const head = newDay || prev.author !== m.author || m.ts - prev.ts > GROUP_MS || !!m.replyTo;
          return (
            <Fragment key={m.id}>
              {newDay && <DayDivider ts={m.ts} />}
              <MessageRow
                message={m}
                me={me}
                head={head}
                editing={editing === m.id}
                onEdit={(on) => setEditing(on ? m.id : null)}
                onReply={onReply}
                onOpenDm={onOpenDm}
              />
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

/** Sino: escolher quando este canal avisa. */
function NotifyMenu({ channelId }: { channelId: string }) {
  useChatVersion();
  const level = notifyLevel(channelId);
  return (
    <Menu
      side="bottom"
      align="end"
      trigger={
        <button type="button" aria-label="Notificações" className={cn("flex size-8 items-center justify-center rounded-md hover:text-foreground", level === "none" && "text-destructive")}>
          {level === "none" ? <BellOff className="size-5" /> : <Bell className="size-5" />}
        </button>
      }
    >
      <MenuLabel>Notificações deste canal</MenuLabel>
      <MenuRadio<NotifyLevel>
        value={level}
        onChange={(v) => setNotifyLevel(channelId, v)}
        options={[
          { value: "all", label: "Todas as mensagens" },
          { value: "mentions", label: "Só @menções", hint: "Quando alguém escrever @seu-nome ou @todos" },
          { value: "none", label: "Nada", hint: "Silencia o canal" },
        ]}
      />
    </Menu>
  );
}

function PinsButton({ view, me, onOpenDm }: { view: TextView; me: string; onOpenDm: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pins, setPins] = useState<Message[] | null>(null);
  const messages = useMessages(view.id);
  const pinnedNow = messages.filter((m) => m.pinned).length;

  useEffect(() => {
    if (!open) return;
    setPins(null);
    fetchPins(view.id)
      .then(setPins)
      .catch(() => setPins([]));
  }, [open, view.id, pinnedNow]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      className="w-[420px] max-w-[calc(100vw-24px)] overflow-hidden"
      trigger={
        <button type="button" aria-label="Mensagens fixadas" className={cn("flex size-8 items-center justify-center rounded-md hover:text-foreground", open && "text-foreground")}>
          <Pin className="size-5" />
        </button>
      }
    >
      <div className="flex h-12 items-center gap-2 bg-black/25 px-4 font-semibold">
        <Pin className="size-5 text-muted-foreground" /> Mensagens fixadas
      </div>
      <div className="scrollbar-thin max-h-[60vh] overflow-y-auto p-2">
        {pins == null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : pins.length ? (
          <ol className="flex flex-col gap-2">
            {pins.map((m) => (
              <PreviewCard key={m.id} message={m} me={me} onOpenDm={onOpenDm} onJump={() => {
                setOpen(false);
                jumpTo(m.id);
              }} />
            ))}
          </ol>
        ) : (
          <div className="px-6 py-10 text-center">
            <Pin className="mx-auto size-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhuma mensagem fixada ainda. Passe o mouse numa mensagem e use os três pontinhos pra fixar.
            </p>
          </div>
        )}
      </div>
    </Popover>
  );
}

function SearchPanel({
  view,
  query,
  me,
  onOpenDm,
  onClose,
}: {
  view: TextView;
  query: string;
  me: string;
  onOpenDm: (name: string) => void;
  onClose: () => void;
}) {
  const [results, setResults] = useState<Message[] | null>(null);
  useEffect(() => {
    setResults(null);
    searchMessages(view.id, query)
      .then(setResults)
      .catch(() => setResults([]));
  }, [view.id, query]);

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-black/40 bg-sidebar max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:w-full max-lg:max-w-[420px]">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-black/50 px-4">
        <span className="text-sm font-semibold">
          {results ? `${results.length}${results.length === 25 ? "+" : ""} resultados` : "Buscando..."}
        </span>
        <button type="button" aria-label="Fechar busca" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="size-5" />
        </button>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
        {results == null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : results.length ? (
          <ol className="flex flex-col gap-2">
            {results.map((m) => (
              <PreviewCard key={m.id} message={m} me={me} onOpenDm={onOpenDm} onJump={() => jumpTo(m.id)} />
            ))}
          </ol>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Nada encontrado pra “{query}”.</p>
        )}
      </div>
    </aside>
  );
}

function PreviewCard({ message, me, onOpenDm, onJump }: { message: Message; me: string; onOpenDm: (n: string) => void; onJump: () => void }) {
  return (
    <li className="group/card relative overflow-hidden rounded-lg border border-white/6 bg-main pt-2 pb-3">
      <ol>
        <MessageRow message={message} me={me} head editing={false} onEdit={() => {}} onReply={() => {}} onOpenDm={onOpenDm} preview />
      </ol>
      <button
        type="button"
        onClick={onJump}
        className="absolute top-2 right-2 rounded-md bg-elevated px-2 py-1 text-xs font-semibold opacity-0 group-hover/card:opacity-100"
      >
        Ir
      </button>
    </li>
  );
}

function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

