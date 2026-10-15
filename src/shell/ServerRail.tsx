import type { ReactElement, ReactNode } from "react";
import { MessageCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { unreadState, useChatVersion, useDms, type Dm } from "@/chat/store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { server, type Channel } from "./data";

export function Tip({ label, side = "top", children }: { label: string; side?: "top" | "right" | "bottom" | "left"; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} sideOffset={side === "right" ? 12 : 6} className="font-semibold">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Coluna da esquerda (72px, ícones de 48px): conversas diretas, não lidas e o servidor. */
export function ServerRail({
  mode,
  channels,
  onHome,
  onServer,
  onSelectDm,
}: {
  mode: "server" | "home";
  channels: Channel[];
  onHome: () => void;
  onServer: () => void;
  onSelectDm: (dm: Dm) => void;
}) {
  useChatVersion();
  const dms = useDms();
  const unreadDms = dms.filter((d) => unreadState(d.id).unread);
  const text = channels.filter((c) => c.kind === "text");
  const serverUnread = text.some((c) => unreadState(c.id).unread);
  const serverMentions = text.reduce((n, c) => n + unreadState(c.id).mentions, 0);

  return (
    <nav className="scrollbar-hide flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-rail py-3">
      <RailItem label="Mensagens diretas" active={mode === "home"} onClick={onHome}>
        <MessageCircle className="size-6" />
      </RailItem>
      {unreadDms.map((d) => (
        <RailItem key={d.id} label={d.with} unread badge={unreadState(d.id).mentions} variant="avatar" onClick={() => onSelectDm(d)}>
          <Avatar name={d.with} size={48} />
        </RailItem>
      ))}
      <span className="h-0.5 w-8 rounded-full bg-white/8" />
      <RailItem label={server.name} active={mode === "server"} unread={serverUnread} badge={serverMentions} onClick={onServer}>
        <span className="font-display text-xl tracking-wide">{server.short}</span>
      </RailItem>
      <RailItem
        label="Adicionar um servidor"
        variant="action"
        onClick={() => toast("Por enquanto o MonkeyCord tem um servidor só", { description: "Crie canais novos pelo menu do servidor." })}
      >
        <Plus className="size-6" />
      </RailItem>
    </nav>
  );
}

function RailItem({
  label,
  active,
  unread,
  badge = 0,
  variant = "server",
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  unread?: boolean;
  badge?: number;
  variant?: "server" | "action" | "avatar";
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group/rail relative flex w-full justify-center">
      {/* Pílula da esquerda: ponto se tem não lida, cresce no hover e quando é o selecionado */}
      <span
        className={cn(
          "absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-all duration-200",
          active ? "h-10" : unread ? "h-2 group-hover/rail:h-5" : "h-0 group-hover/rail:h-5"
        )}
      />
      <Tip label={label} side="right">
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(
            "relative flex size-12 items-center justify-center transition-all duration-200",
            active ? "rounded-2xl" : "rounded-3xl hover:rounded-2xl",
            variant === "server" &&
              (active
                ? "bg-foreground text-background"
                : "bg-elevated text-foreground hover:bg-foreground hover:text-background"),
            variant === "action" && "bg-elevated text-success hover:bg-success hover:text-background",
            variant === "avatar" && "hover:rounded-3xl"
          )}
        >
          {children}
        </button>
      </Tip>
      {badge > 0 && (
        <span className="pointer-events-none absolute right-2.5 -bottom-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-white ring-4 ring-rail">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </div>
  );
}
