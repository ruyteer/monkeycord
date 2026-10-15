import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Loader2, PlusCircle, Smile, X } from "lucide-react";
import { toast } from "sonner";
import type { Attachment } from "@/chat/protocol";
import { sendMessage, uploadFile, type Message } from "@/chat/store";
import { cn } from "@/lib/utils";
import { Avatar, nameColor } from "./Avatar";
import { EmojiPicker } from "./EmojiPicker";
import { Tip } from "./ServerRail";
import { Popover } from "./ui";

type Upload = { key: string; file: File; preview?: string; done?: Attachment; error?: boolean };

type Props = {
  channelId: string;
  placeholder: string;
  me: string;
  names: string[];
  replyTo: Message | null;
  onCancelReply: () => void;
  /** Seta pra cima com a caixa vazia: edita sua última mensagem */
  onEditLast: () => void;
  /** Arquivos soltos na área do chat */
  dropped: File[] | null;
  onDroppedTaken: () => void;
};

export function Composer({ channelId, placeholder, me, names, replyTo, onCancelReply, onEditLast, dropped, onDroppedTaken }: Props) {
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [emoji, setEmoji] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Rascunho por canal, igual ao Discord
  const drafts = useRef(new Map<string, string>());
  const prevChannel = useRef(channelId);
  useEffect(() => {
    drafts.current.set(prevChannel.current, text);
    setText(drafts.current.get(channelId) ?? "");
    setUploads([]);
    setMention(null);
    prevChannel.current = channelId;
    ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  // Cresce com o texto até ~50% da tela
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.5)}px`;
  }, [text]);

  const addFiles = (files: File[]) => {
    const list = files.slice(0, 10 - uploads.length);
    if (files.length > list.length) toast("No máximo 10 arquivos por mensagem");
    for (const file of list) {
      const key = crypto.randomUUID();
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setUploads((u) => [...u, { key, file, preview }]);
      uploadFile(channelId, file)
        .then((done) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, done } : x))))
        .catch((err: Error) => {
          toast.error("Não deu pra enviar o arquivo", { description: err.message });
          setUploads((u) => u.filter((x) => x.key !== key));
        });
    }
  };

  useEffect(() => {
    if (!dropped) return;
    addFiles(dropped);
    onDroppedTaken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropped]);

  const uploading = uploads.some((u) => !u.done);

  const send = () => {
    if (uploading) {
      toast("Espera os arquivos terminarem de subir");
      return;
    }
    const atts = uploads.flatMap((u) => (u.done ? [u.done] : []));
    if (!text.trim() && !atts.length) return;
    sendMessage(channelId, me, text, atts, replyTo ?? undefined);
    uploads.forEach((u) => u.preview && URL.revokeObjectURL(u.preview));
    setText("");
    setUploads([]);
    onCancelReply();
  };

  const matches = mention
    ? names
        .filter((n) => n !== me && n.toLowerCase().includes(mention.query.toLowerCase()))
        .concat("todos".includes(mention.query.toLowerCase()) ? ["todos"] : [])
        .slice(0, 8)
    : [];

  const pickMention = (name: string) => {
    if (!mention) return;
    const el = ref.current!;
    const caret = el.selectionStart;
    const next = text.slice(0, mention.start) + "@" + name + " " + text.slice(caret);
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + name.length + 2;
      el.setSelectionRange(pos, pos);
      el.focus();
    });
  };

  const trackMention = (value: string, caret: number) => {
    const m = value.slice(0, caret).match(/(^|\s)@([\p{L}\p{N}_.-]*)$/u);
    setMention(m ? { query: m[2], start: caret - m[2].length - 1, index: 0 } : null);
  };

  const insertAtCaret = (s: string) => {
    const el = ref.current;
    if (!el) return setText((t) => t + s);
    const a = el.selectionStart;
    const b = el.selectionEnd;
    setText(text.slice(0, a) + s + text.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + s.length, a + s.length);
    });
  };

  return (
    <div className="relative shrink-0 px-4 pb-6">
      {!!matches.length && (
        <ul className="absolute inset-x-4 bottom-full mb-2 overflow-hidden rounded-lg border border-white/8 bg-popover p-1.5 shadow-2xl">
          <li className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Membros</li>
          {matches.map((n, i) => (
            <li key={n}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(n);
                }}
                className={cn("flex h-9 w-full items-center gap-2 rounded-md px-2 text-left", i === mention!.index && "bg-white/10")}
              >
                {n === "todos" ? <span className="w-6 text-center">@</span> : <Avatar name={n} size={24} />}
                <span className="font-medium" style={{ color: n === "todos" ? undefined : nameColor(n) }}>
                  {n}
                </span>
                {n === "todos" && <span className="text-xs text-muted-foreground">avisa todo mundo</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg bg-field">
        {replyTo && (
          <div className="flex h-9 items-center justify-between rounded-t-lg bg-black/25 px-4 text-sm text-muted-foreground">
            <span className="truncate">
              Respondendo a <b style={{ color: nameColor(replyTo.author) }}>{replyTo.author}</b>
            </span>
            <button type="button" aria-label="Cancelar resposta" onClick={onCancelReply} className="hover:text-foreground">
              <X className="size-4.5" />
            </button>
          </div>
        )}

        {!!uploads.length && (
          <div className="scrollbar-thin flex gap-3 overflow-x-auto border-b border-white/6 p-3">
            {uploads.map((u) => (
              <div key={u.key} className="relative flex w-36 shrink-0 flex-col gap-1.5 rounded-lg bg-elevated p-2">
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-black/30">
                  {u.preview ? (
                    <img src={u.preview} alt="" className="size-full object-cover" />
                  ) : (
                    <FileText className="size-10 text-muted-foreground" />
                  )}
                  {!u.done && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
                      <Loader2 className="size-6 animate-spin" />
                    </div>
                  )}
                </div>
                <span className="truncate text-xs">{u.file.name}</span>
                <button
                  type="button"
                  aria-label="Remover anexo"
                  onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                  className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-md border border-white/10 bg-elevated text-destructive hover:bg-destructive hover:text-white"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start">
          <ComposerIcon label="Enviar arquivo" onClick={() => fileInput.current?.click()}>
            <PlusCircle className="size-6" />
          </ComposerIcon>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <textarea
            ref={ref}
            rows={1}
            value={text}
            maxLength={2000}
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value);
              trackMention(e.target.value, e.target.selectionStart);
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (matches.length && mention) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const d = e.key === "ArrowDown" ? 1 : -1;
                  setMention({ ...mention, index: (mention.index + d + matches.length) % matches.length });
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickMention(matches[mention.index]);
                  return;
                }
                if (e.key === "Escape") {
                  setMention(null);
                  return;
                }
              }
              if (e.key === "Escape" && replyTo) onCancelReply();
              if (e.key === "ArrowUp" && !text) {
                e.preventDefault();
                onEditLast();
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className="scrollbar-thin min-w-0 flex-1 resize-none bg-transparent py-[11px] leading-[1.375rem] outline-none placeholder:text-muted-foreground/70"
          />
          <Popover
            open={emoji}
            onOpenChange={setEmoji}
            side="top"
            align="end"
            trigger={
              <button
                type="button"
                aria-label="Emoji"
                className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <Smile className="size-6" />
              </button>
            }
          >
            <EmojiPicker
              onPick={(e) => {
                insertAtCaret(e);
                setEmoji(false);
              }}
            />
          </Popover>
        </div>
      </div>
    </div>
  );
}

function ComposerIcon({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex h-11 w-12 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {children}
      </button>
    </Tip>
  );
}
