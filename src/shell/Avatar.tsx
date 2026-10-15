import { initials } from "@/call/Tile";
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
  status?: "online" | null;
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
      {status === "online" && (
        <span
          className="absolute -right-0.5 -bottom-0.5 rounded-full bg-success"
          style={{ width: dot, height: dot, boxShadow: `0 0 0 3px ${ring}` }}
        />
      )}
    </span>
  );
}
