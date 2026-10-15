import type { ReactElement, ReactNode } from "react";
import { Compass, MessageCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { server } from "./data";

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

export const soon = () => toast("Em breve");

/** Coluna da esquerda com os servidores (72px, ícones de 48px). */
export function ServerRail() {
  return (
    <nav className="scrollbar-hide flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-rail py-3">
      <RailItem label="Mensagens diretas" onClick={soon}>
        <MessageCircle className="size-6" />
      </RailItem>
      <span className="h-0.5 w-8 rounded-full bg-white/8" />
      <RailItem label={server.name} active>
        <span className="font-display text-xl tracking-wide">{server.short}</span>
      </RailItem>
      <RailItem label="Adicionar um servidor" variant="action" onClick={soon}>
        <Plus className="size-6" />
      </RailItem>
      <RailItem label="Explorar" variant="action" onClick={soon}>
        <Compass className="size-6" />
      </RailItem>
    </nav>
  );
}

function RailItem({
  label,
  active,
  variant = "server",
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  variant?: "server" | "action";
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group/rail relative flex w-full justify-center">
      {/* Pílula da esquerda: aparece no hover, cresce quando é o selecionado */}
      <span
        className={cn(
          "absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-all duration-200",
          active ? "h-10" : "h-0 group-hover/rail:h-5"
        )}
      />
      <Tip label={label} side="right">
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(
            "flex size-12 items-center justify-center overflow-hidden transition-all duration-200",
            active ? "rounded-2xl" : "rounded-3xl hover:rounded-2xl",
            variant === "server" &&
              (active
                ? "bg-foreground text-background"
                : "bg-elevated text-foreground hover:bg-foreground hover:text-background"),
            variant === "action" && "bg-elevated text-success hover:bg-success hover:text-background"
          )}
        >
          {children}
        </button>
      </Tip>
    </div>
  );
}
