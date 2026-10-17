import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Hash, Volume2 } from "lucide-react";
import { unreadState, useDms, usePresence } from "@/chat/store";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import type { Channel } from "./data";

type Item =
  | { kind: "channel"; channel: Channel; label: string }
  | { kind: "person"; name: string; label: string };

/** Ctrl+K: pula pra qualquer canal, conversa ou pessoa digitando o nome. */
export function QuickSwitcher({
  open,
  onOpenChange,
  me,
  channels,
  onChannel,
  onPerson,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  me: string;
  channels: Channel[];
  onChannel: (c: Channel) => void;
  onPerson: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const dms = useDms();
  const { statuses } = usePresence();

  useEffect(() => {
    if (open) {
      setQ("");
      setIndex(0);
    }
  }, [open]);

  const people = [...new Set([...dms.map((d) => d.with), ...Object.keys(statuses)])].filter((n) => n !== me);
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const query = norm(q.trim().replace(/^[#@!*]/, ""));
  const prefix = q.trim()[0];
  const all: Item[] = [
    ...channels
      .filter((c) => prefix !== "@" && (prefix !== "!" || c.kind === "voice") && (prefix !== "#" || c.kind === "text"))
      .map((c) => ({ kind: "channel" as const, channel: c, label: c.name })),
    ...(prefix === "#" || prefix === "!" ? [] : people.map((n) => ({ kind: "person" as const, name: n, label: n }))),
  ];
  // Sem busca: primeiro o que tem não lida
  const items = (query ? all.filter((i) => norm(i.label).includes(query)) : all)
    .sort((a, b) => {
      const ua = a.kind === "channel" && unreadState(a.channel.id).unread ? 0 : 1;
      const ub = b.kind === "channel" && unreadState(b.channel.id).unread ? 0 : 1;
      return query ? norm(a.label).indexOf(query) - norm(b.label).indexOf(query) : ua - ub;
    })
    .slice(0, 12);

  const choose = (it: Item | undefined) => {
    if (!it) return;
    onOpenChange(false);
    if (it.kind === "channel") onChannel(it.channel);
    else onPerson(it.name);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/70" />
        <DialogPrimitive.Popup className="fixed top-[18%] left-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-white/8 bg-popover p-4 shadow-2xl outline-none">
          <DialogPrimitive.Title className="sr-only">Pular pra</DialogPrimitive.Title>
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const d = e.key === "ArrowDown" ? 1 : -1;
                setIndex((i) => (i + d + items.length) % Math.max(1, items.length));
              }
              if (e.key === "Enter") choose(items[index]);
            }}
            placeholder="Pra onde você quer ir?"
            className="h-12 w-full rounded-md bg-rail px-3 text-lg outline-none placeholder:text-muted-foreground"
          />
          <ul className="mt-3 max-h-[50vh] overflow-y-auto">
            {items.map((it, i) => {
              const unread = it.kind === "channel" && unreadState(it.channel.id).unread;
              return (
                <li key={it.kind + it.label + (it.kind === "channel" ? it.channel.id : "")}>
                  <button
                    type="button"
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => choose(it)}
                    className={cn("flex h-10 w-full items-center gap-2 rounded-md px-2 text-left", i === index && "bg-white/10")}
                  >
                    {it.kind === "channel" ? (
                      it.channel.kind === "text" ? <Hash className="size-5 text-muted-foreground" /> : <Volume2 className="size-5 text-muted-foreground" />
                    ) : (
                      <Avatar name={it.name} size={24} status={statuses[it.name] ?? "offline"} ring="var(--popover)" />
                    )}
                    <span className={cn("truncate", unread ? "font-semibold text-foreground" : "text-foreground/85")}>{it.label}</span>
                    {unread && <span className="ml-auto size-2 rounded-full bg-foreground" />}
                  </button>
                </li>
              );
            })}
            {!items.length && <li className="py-6 text-center text-sm text-muted-foreground">Nada com esse nome.</li>}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Dica: comece com <b>#</b> pra canais de texto, <b>!</b> pra voz e <b>@</b> pra pessoas.
          </p>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
