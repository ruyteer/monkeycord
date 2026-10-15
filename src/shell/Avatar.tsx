import { initials } from "@/call/Tile";
import type { VisibleStatus } from "@/chat/protocol";
import { cn } from "@/lib/utils";

/** Tom fixo por nome, dentro da paleta escura do MonkeyCord. */
export function nameHue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function nameColor(name: string) {
  return `hsl(${nameHue(name)} 45% 72%)`;
}

type Props = {
  name: string;
  size?: number;
  status?: VisibleStatus | null;
  speaking?: boolean;
  /** Cor do recorte do indicador de status (fundo de onde o avatar está) */
  ring?: string;
  className?: string;
};

export function Avatar({ name, size = 32, status, speaking, ring = "var(--mc-sidebar)", className }: Props) {
  const dot = Math.max(10, Math.round(size * 0.32));
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      <span
        className={cn(
          "flex size-full items-center justify-center rounded-full font-semibold text-white/95 transition-shadow",
          speaking && "shadow-[0_0_0_2px_var(--success)]"
        )}
        style={{
          background: `hsl(${nameHue(name)} 22% 26%)`,
          fontSize: Math.round(size * 0.38),
        }}
      >
        {initials(name)}
      </span>
      {status && <StatusDot status={status} size={dot} ring={ring} className="absolute -right-0.5 -bottom-0.5" />}
    </span>
  );
}

export const statusLabel: Record<VisibleStatus | "invisible", string> = {
  online: "Online",
  idle: "Ausente",
  dnd: "Não perturbe",
  offline: "Offline",
  invisible: "Invisível",
};

/** Bolinha de status: verde, lua amarela, traço vermelho ou anel cinza. */
export function StatusDot({
  status,
  size = 10,
  ring,
  className,
}: {
  status: VisibleStatus | "invisible";
  size?: number;
  ring?: string;
  className?: string;
}) {
  const hole = Math.round(size * 0.5);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full",
        status === "online" && "bg-success",
        status === "idle" && "bg-warning",
        status === "dnd" && "bg-destructive",
        (status === "offline" || status === "invisible") && "bg-zinc-500",
        className
      )}
      style={{ width: size, height: size, boxShadow: ring ? `0 0 0 3px ${ring}` : undefined }}
    >
      {status === "idle" && (
        <span className="absolute rounded-full" style={{ width: hole + 1, height: hole + 1, top: -1, left: -1, background: ring ?? "var(--popover)" }} />
      )}
      {status === "dnd" && <span className="rounded-full" style={{ width: hole + 1, height: Math.max(2, size / 5), background: ring ?? "var(--popover)" }} />}
      {(status === "offline" || status === "invisible") && (
        <span className="rounded-full" style={{ width: hole, height: hole, background: ring ?? "var(--popover)" }} />
      )}
    </span>
  );
}
