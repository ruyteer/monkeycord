import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, FileText, MoreHorizontal, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2, Copy, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { Attachment } from "@/chat/protocol";
import {
  deleteMessage,
  editMessage,
  fileUrl,
  mentionsMe,
  pinMessage,
  sendMessage,
  toggleReaction,
  type Message,
} from "@/chat/store";
import { cn } from "@/lib/utils";
import { Avatar, nameColor } from "./Avatar";
import { EmojiPicker, QUICK_REACTIONS } from "./EmojiPicker";
import { Markdown } from "./Markdown";
import { Tip } from "./ServerRail";
import { ContextMenu, Menu, MenuItem, MenuSeparator, Modal, ModalButton, Popover } from "./ui";
import { UserPopover } from "./UserPopover";

type RowProps = {
  message: Message;
  me: string;
  head: boolean;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onReply: (m: Message) => void;
  onOpenDm: (name: string) => void;
  /** Versão compacta (lista de fixadas e busca): sem ações */
  preview?: boolean;
};

export function MessageRow({ message: m, me, head, editing, onEdit, onReply, onOpenDm, preview }: RowProps) {
  const [confirm, setConfirm] = useState(false);
  const [picker, setPicker] = useState(false);
  const mine = m.author === me;
  const highlight = !mine && mentionsMe(m.content);
  const time = new Date(m.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const askDelete = (e?: { shiftKey?: boolean }) => {
    // Igual ao Discord: Shift + clique apaga sem perguntar
    if (e?.shiftKey) void deleteMessage(m);
    else setConfirm(true);
  };

  const menu = (
    <>
      <MenuItem icon={<SmilePlus />} onClick={() => setPicker(true)}>
        Adicionar reação
      </MenuItem>
      {mine && !m.pending && (
        <MenuItem icon={<Pencil />} onClick={() => onEdit(true)}>
          Editar mensagem
        </MenuItem>
      )}
      <MenuItem icon={<Reply />} onClick={() => onReply(m)}>
        Responder
      </MenuItem>
      {!m.pending && (
        <MenuItem icon={m.pinned ? <PinOff /> : <Pin />} onClick={() => void pinMessage(m, !m.pinned)}>
          {m.pinned ? "Desafixar mensagem" : "Fixar mensagem"}
        </MenuItem>
      )}
      <MenuItem
        icon={<Copy />}
        onClick={() => {
          void navigator.clipboard?.writeText(m.content);
          toast("Texto copiado");
        }}
      >
        Copiar texto
      </MenuItem>
      {mine && (
        <>
          <MenuSeparator />
          <MenuItem danger icon={<Trash2 />} onClick={(e) => askDelete(e)}>
            Apagar mensagem
          </MenuItem>
        </>
      )}
    </>
  );

  const row = (
    <li
      id={`msg-${m.id}`}
      className={cn(
        "group/msg relative py-0.5 pr-12 pl-[72px]",
        head && "mt-4",
        !preview && "hover:bg-black/15",
        highlight && "border-l-2 border-warning bg-warning/8 hover:bg-warning/12",
        editing && "bg-black/15"
      )}
    >
      {m.replyTo && (
        <div className="relative mb-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground before:absolute before:top-2.5 before:-left-[38px] before:h-3 before:w-8 before:rounded-tl-md before:border-t-2 before:border-l-2 before:border-white/15">
          <Avatar name={m.replyTo.author} size={16} />
          <button
            type="button"
            className="shrink-0 font-medium hover:underline"
            style={{ color: nameColor(m.replyTo.author) }}
            onClick={() => jumpTo(m.replyTo!.id)}
          >
            @{m.replyTo.author}
          </button>
          <button type="button" className="min-w-0 truncate hover:text-foreground" onClick={() => jumpTo(m.replyTo!.id)}>
            {m.replyTo.content || "Clique pra ver o anexo"}
          </button>
        </div>
      )}
      {head ? (
        <>
          <UserPopover name={m.author} me={me} onOpenDm={onOpenDm}>
            <button type="button" className="absolute top-1 left-4 rounded-full">
              <Avatar name={m.author} size={40} />
            </button>
          </UserPopover>
          <div className="flex items-baseline gap-2">
            <UserPopover name={m.author} me={me} onOpenDm={onOpenDm}>
              <button type="button" className="font-medium hover:underline" style={{ color: nameColor(m.author) }}>
                {m.author}
              </button>
            </UserPopover>
            <time className="text-xs text-muted-foreground">{fullTime(m.ts)}</time>
          </div>
        </>
      ) : (
        <time className="absolute top-1 left-0 w-[72px] text-center text-[11px] leading-5 text-muted-foreground opacity-0 group-hover/msg:opacity-100">
          {time}
        </time>
      )}

      {editing ? (
        <EditBox message={m} onDone={() => onEdit(false)} />
      ) : (
        m.content && (
          <div
            className={cn(
              "leading-[1.375rem] break-words whitespace-pre-wrap text-foreground/90",
              m.pending && "text-muted-foreground",
              m.failed && "text-destructive"
            )}
          >
            <RichText text={m.content} me={me} />
            {m.editedTs && <span className="ml-1 text-[10px] text-muted-foreground select-none">(editado)</span>}
          </div>
        )
      )}

      {m.attachments?.map((a) => <AttachmentView key={a.id} channelId={m.channelId} attachment={a} />)}

      {m.failed && (
        <div className="mt-1 flex items-center gap-3 text-xs">
          <span className="text-destructive">Não foi enviada.</span>
          <button
            type="button"
            className="flex items-center gap-1 text-foreground/80 hover:underline"
            onClick={() => {
              void deleteMessage(m);
              sendMessage(m.channelId, m.author, m.content, m.attachments);
            }}
          >
            <RotateCw className="size-3" /> Tentar de novo
          </button>
          <button type="button" className="text-muted-foreground hover:underline" onClick={() => void deleteMessage(m)}>
            Descartar
          </button>
        </div>
      )}

      {!!m.reactions?.length && (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.reactions.map((r) => {
            const on = r.users.includes(me);
            return (
              <Tip key={r.emoji} label={`${r.users.join(", ")} reagiu com ${r.emoji}`}>
                <button
                  type="button"
                  disabled={preview}
                  onClick={() => void toggleReaction(m, r.emoji)}
                  className={cn(
                    "flex h-6 items-center gap-1.5 rounded-md border px-1.5 text-sm transition-colors",
                    on ? "border-foreground/40 bg-white/12" : "border-transparent bg-white/6 hover:border-white/20"
                  )}
                >
                  <span className="text-base leading-none">{r.emoji}</span>
                  <span className={cn("text-xs font-semibold", on ? "text-foreground" : "text-muted-foreground")}>{r.users.length}</span>
                </button>
              </Tip>
            );
          })}
        </div>
      )}

      {!preview && !editing && !m.pending && !m.failed && (
        <Toolbar
          message={m}
          mine={mine}
          picker={picker}
          setPicker={setPicker}
          onEdit={() => onEdit(true)}
          onReply={() => onReply(m)}
          onDelete={askDelete}
          menu={menu}
        />
      )}

      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Apagar mensagem"
        description="Tem certeza que quer apagar esta mensagem? Dica: segure Shift ao clicar na lixeira pra pular esta pergunta."
        footer={
          <>
            <ModalButton variant="ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </ModalButton>
            <ModalButton
              variant="danger"
              autoFocus
              onClick={() => {
                setConfirm(false);
                void deleteMessage(m);
              }}
            >
              Apagar
            </ModalButton>
          </>
        }
      >
        <div className="rounded-md border border-white/8 bg-main p-3 text-sm">
          <span className="font-medium" style={{ color: nameColor(m.author) }}>
            {m.author}
          </span>
          <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-foreground/85">{m.content || "📎 Anexo"}</p>
        </div>
      </Modal>
    </li>
  );

  if (preview) return row;
  return <ContextMenu menu={menu}>{row}</ContextMenu>;
}

function Toolbar({
  message: m,
  mine,
  picker,
  setPicker,
  onEdit,
  onReply,
  onDelete,
  menu,
}: {
  message: Message;
  mine: boolean;
  picker: boolean;
  setPicker: (o: boolean) => void;
  onEdit: () => void;
  onReply: () => void;
  onDelete: (e: { shiftKey: boolean }) => void;
  menu: ReactNode;
}) {
  const btn = "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground";
  return (
    <div
      className={cn(
        "absolute -top-4 right-4 z-10 flex items-center rounded-lg border border-white/8 bg-elevated p-0.5 shadow-lg",
        // Invisível também pro mouse: senão os tooltips das outras mensagens aparecem
        "pointer-events-none opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100",
        "has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100",
        picker && "pointer-events-auto opacity-100"
      )}
    >
      {QUICK_REACTIONS.slice(0, 3).map((e) => (
        <Tip key={e} label={`Reagir com ${e}`}>
          <button type="button" className={cn(btn, "text-lg")} onClick={() => void toggleReaction(m, e)}>
            {e}
          </button>
        </Tip>
      ))}
      <span className="mx-0.5 h-5 w-px bg-white/10" />
      <Popover
        open={picker}
        onOpenChange={setPicker}
        side="left"
        align="start"
        trigger={
          <button type="button" aria-label="Adicionar reação" className={btn}>
            <SmilePlus className="size-5" />
          </button>
        }
      >
        <EmojiPicker
          onPick={(e) => {
            setPicker(false);
            void toggleReaction(m, e);
          }}
        />
      </Popover>
      {mine ? (
        <Tip label="Editar">
          <button type="button" aria-label="Editar" className={btn} onClick={onEdit}>
            <Pencil className="size-4.5" />
          </button>
        </Tip>
      ) : (
        <Tip label="Responder">
          <button type="button" aria-label="Responder" className={btn} onClick={onReply}>
            <Reply className="size-5" />
          </button>
        </Tip>
      )}
      {mine && (
        <Tip label="Apagar">
          <button type="button" aria-label="Apagar" className={cn(btn, "hover:text-destructive")} onClick={(e) => onDelete(e)}>
            <Trash2 className="size-4.5" />
          </button>
        </Tip>
      )}
      <MoreMenu menu={menu} className={btn} />
    </div>
  );
}

function MoreMenu({ menu, className }: { menu: ReactNode; className: string }) {
  return (
    <Menu
      side="left"
      align="start"
      trigger={
        <button type="button" aria-label="Mais" className={className}>
          <MoreHorizontal className="size-5" />
        </button>
      }
    >
      {menu}
    </Menu>
  );
}

/** Edição no lugar: Enter salva, Esc cancela. Apagar tudo = pergunta se quer apagar a mensagem. */
function EditBox({ message: m, onDone }: { message: Message; onDone: () => void }) {
  const [text, setText] = useState(m.content);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Depois do frame: a barra de ações que tinha o foco acabou de sumir e o tooltip devolve o foco pro body
    const id = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 30);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
  }, [text]);

  const save = () => {
    if (!text.trim() && !m.attachments?.length) {
      void deleteMessage(m);
    } else void editMessage(m, text);
    onDone();
  };

  return (
    <div className="my-1">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          }
        }}
        className="scrollbar-thin w-full resize-none rounded-lg bg-field px-4 py-[11px] leading-[1.375rem] outline-none"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Esc pra{" "}
        <button type="button" className="text-sky-300 hover:underline" onClick={onDone}>
          cancelar
        </button>{" "}
        · Enter pra{" "}
        <button type="button" className="text-sky-300 hover:underline" onClick={save}>
          salvar
        </button>
      </p>
    </div>
  );
}

/** Texto da mensagem com a formatação do Discord (ver Markdown.tsx). */
export function RichText({ text, me }: { text: string; me: string }) {
  return <Markdown text={text} me={me} />;
}

function AttachmentView({ channelId, attachment: a }: { channelId: string; attachment: Attachment }) {
  const url = fileUrl(channelId, a);
  if (a.type.startsWith("image/") && a.type !== "image/svg+xml") {
    const w = a.width ?? 400;
    const h = a.height ?? 300;
    const scale = Math.min(1, 400 / w, 350 / h);
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1 block w-fit overflow-hidden rounded-lg bg-black/30">
        <img
          src={url}
          alt={a.name}
          loading="lazy"
          width={Math.round(w * scale)}
          height={Math.round(h * scale)}
          className="max-w-full object-contain"
          style={{ aspectRatio: `${w} / ${h}` }}
        />
      </a>
    );
  }
  if (a.type.startsWith("video/")) {
    return <video src={url} controls preload="metadata" className="mt-1 max-h-[350px] max-w-[min(100%,400px)] rounded-lg bg-black" />;
  }
  if (a.type.startsWith("audio/")) {
    return <audio src={url} controls preload="metadata" className="mt-1 w-full max-w-[400px]" />;
  }
  return (
    <a
      href={url}
      download={a.name}
      className="mt-1 flex w-full max-w-[400px] items-center gap-3 rounded-lg border border-white/8 bg-elevated p-3 hover:bg-white/8"
    >
      <FileText className="size-8 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-sky-300">{a.name}</span>
        <span className="block text-xs text-muted-foreground">{formatSize(a.size)}</span>
      </span>
      <Download className="size-5 shrink-0 text-muted-foreground" />
    </a>
  );
}

/** Rola até a mensagem e pisca; se não estiver carregada, avisa. */
export function jumpTo(id: string) {
  const el = document.getElementById(`msg-${id}`);
  if (!el) {
    toast("Essa mensagem é antiga demais pra aparecer aqui");
    return;
  }
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("msg-flash");
  setTimeout(() => el.classList.remove("msg-flash"), 1600);
}

export function formatSize(n: number) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function fullTime(ts: number) {
  const d = new Date(ts);
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return `Hoje às ${hm}`;
  if (d.toDateString() === yesterday.toDateString()) return `Ontem às ${hm}`;
  return `${d.toLocaleDateString("pt-BR")} ${hm}`;
}
