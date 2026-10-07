import { MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Person } from "./useCall";
import { Video } from "./Video";

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "?";
}

type Props = {
  person: Person;
  speaking?: boolean;
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
  autoPip?: boolean;
  main?: boolean;
};

export function Tile({ person, speaking, compact, className, style, autoPip, main }: Props) {
  return (
    <div
      style={style}
      className={cn(
        "relative overflow-hidden rounded-xl border border-white/6 bg-[#111113] transition-shadow duration-300",
        speaking && "speaking",
        className
      )}
    >
      {person.videoEnabled ? (
        <Video track={person.videoTrack} mirror={person.isSelf} autoPip={autoPip} main={main} />
      ) : (
        <div className="flex size-full items-center justify-center bg-[radial-gradient(ellipse_at_center,rgb(255_255_255/0.05),transparent_70%)]">
          <div
            className={cn(
              "flex items-center justify-center rounded-full border border-white/10 bg-white/6 font-medium text-foreground/90",
              compact ? "size-10 text-sm" : "size-16 text-xl sm:size-20 sm:text-2xl"
            )}
          >
            {initials(person.name)}
          </div>
        </div>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-linear-to-t from-black/70 to-transparent",
          compact ? "px-2 pt-4 pb-1.5 text-[11px]" : "px-3 pt-6 pb-2.5 text-xs sm:text-sm"
        )}
      >
        {!person.audioEnabled && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/90">
            <MicOff className="size-3 text-white" />
          </span>
        )}
        <span className="truncate font-medium text-white/95">
          {person.name}
          {person.isSelf && <span className="text-white/60"> (você)</span>}
        </span>
      </div>
    </div>
  );
}
