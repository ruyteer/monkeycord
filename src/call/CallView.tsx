import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Link2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Controls } from "./Controls";
import { bestGrid } from "./layout";
import type { Meeting } from "./meeting";
import { PipView, hasDocPip, usePip } from "./Pip";
import { ScreenStage } from "./ScreenStage";
import { Tile } from "./Tile";
import { useCall, type Person } from "./useCall";
import { Audio } from "./Video";

type Props = { meeting: Meeting; room: string; onLeave: () => void };

export function CallView({ meeting, room, onLeave }: Props) {
  const { me, others, people, presenter, speaking } = useCall(meeting);
  const pip = usePip();
  // Celular deitado com alguém apresentando: só o filme na tela
  const immersive = useMedia("(orientation: landscape) and (max-height: 520px)") && !!presenter;
  const chrome = useIdleChrome(immersive);

  const leave = async () => {
    pip.close();
    await meeting.leave().catch(() => {});
    onLeave();
  };

  // Avisos de entrada/saída
  useEffect(() => {
    const joined = meeting.participants.joined;
    const onJoin = (p: { name: string }) => toast(`${p.name} entrou`);
    const onLeft = (p: { name: string }) => toast(`${p.name} saiu`);
    joined.on("participantJoined", onJoin);
    joined.on("participantLeft", onLeft);
    return () => {
      joined.off("participantJoined", onJoin);
      joined.off("participantLeft", onLeft);
    };
  }, [meeting]);

  return (
    <div className="flex h-full flex-col">
      {!immersive && <Header room={room} count={people.length} />}

      <main className={cn("relative min-h-0 flex-1", immersive ? "p-0" : "px-2 sm:px-4")}>
        {presenter ? (
          <PresentLayout
            presenter={presenter}
            people={people}
            speaking={speaking}
            immersive={immersive}
            chrome={chrome}
          />
        ) : others.length === 1 ? (
          <DuoLayout me={me} other={others[0]} speaking={speaking} />
        ) : (
          <GridLayout people={people} speaking={speaking} alone={others.length === 0} room={room} />
        )}
      </main>

      <footer
        className={cn(
          "flex justify-center transition-opacity duration-300",
          immersive
            ? "absolute inset-x-0 bottom-0 z-10 bg-linear-to-t from-black/70 to-transparent pt-10 pb-3"
            : "safe-bottom px-3 pt-3",
          immersive && !chrome && "pointer-events-none opacity-0"
        )}
      >
        <Controls meeting={meeting} me={me} onLeave={leave} onPip={hasDocPip || document.pictureInPictureEnabled ? pip.open : undefined} />
      </footer>

      {/* Som de todo mundo (menos o seu), incluindo o áudio do filme compartilhado */}
      {others.map((p) => (
        <span key={p.id} hidden>
          {p.audioEnabled && <Audio track={p.audioTrack} />}
          {p.screenEnabled && p.screenAudio && <Audio track={p.screenAudio} />}
        </span>
      ))}

      {pip.win && (
        <PipView
          win={pip.win}
          meeting={meeting}
          me={me}
          others={others}
          presenter={presenter}
          speaking={speaking}
          onLeave={leave}
        />
      )}
    </div>
  );
}

function Header({ room, count }: { room: string; count: number }) {
  const [copied, setCopied] = useState(false);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = window.setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  const copy = async () => {
    const url = `${location.origin}/?sala=${encodeURIComponent(room)}`;
    try {
      if (navigator.share && /Mobi/i.test(navigator.userAgent)) {
        await navigator.share({ title: "MonkeyCord", text: "Cola na chamada", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copiado, manda pra galera");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* cancelado */
    }
  };

  return (
    <header className="safe-top flex items-center justify-between gap-3 px-3 pb-2 sm:px-5 sm:pb-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="chrome-title text-2xl leading-none sm:text-3xl">MonkeyCord</span>
        <span className="truncate text-sm text-muted-foreground">#{room}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:gap-2 sm:text-sm">
        <span className="flex items-center gap-1 rounded-full border border-white/6 bg-white/4 px-2.5 py-1 tabular-nums">
          <span className="size-1.5 animate-pulse rounded-full bg-success" />
          {time}
        </span>
        <span className="flex items-center gap-1 rounded-full border border-white/6 bg-white/4 px-2.5 py-1">
          <Users className="size-3.5" />
          {count}
        </span>
        <Button variant="secondary" size="sm" onClick={copy} className="rounded-full px-3">
          {copied ? <Check /> : <Link2 />}
          <span className="max-sm:hidden">Convidar</span>
        </Button>
      </div>
    </header>
  );
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function GridLayout({
  people,
  speaking,
  alone,
  room,
}: {
  people: Person[];
  speaking: string | null;
  alone: boolean;
  room: string;
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const gap = 8;
  const g = bestGrid(people.length, w, h, gap);

  return (
    <div ref={ref} className="relative flex size-full flex-wrap content-center justify-center" style={{ gap }}>
      {people.map((p, i) => (
        <Tile
          key={p.id}
          person={p}
          speaking={p.id === speaking}
          style={{ width: g.w, height: g.h }}
          className="animate-in fade-in zoom-in-95 duration-300"
          main={i === 1}
          autoPip={i === 1}
        />
      ))}
      {alone && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="hero-in rounded-full border border-white/8 bg-black/60 px-4 py-2 text-sm text-foreground/90 backdrop-blur-md">
            Só você em <b>#{room}</b>. Toque em <b>Convidar</b> e chama a galera.
          </div>
        </div>
      )}
    </div>
  );
}

/** Dois na chamada: o outro ocupa a tela e você fica flutuando no canto (tipo Meet). */
function DuoLayout({ me, other, speaking }: { me: Person; other: Person; speaking: string | null }) {
  return (
    <div className="relative size-full">
      <Tile
        person={other}
        speaking={other.id === speaking}
        className="size-full animate-in fade-in duration-300"
        main
        autoPip
      />
      <Tile
        person={me}
        speaking={me.id === speaking}
        compact
        className="absolute right-3 bottom-3 aspect-3/4 w-24 shadow-2xl shadow-black/60 sm:aspect-video sm:w-60"
      />
    </div>
  );
}

/** Alguém compartilhando: tela grande (com zoom) + tira com as pessoas. */
function PresentLayout({
  presenter,
  people,
  speaking,
  immersive,
  chrome,
}: {
  presenter: Person;
  people: Person[];
  speaking: string | null;
  immersive: boolean;
  chrome: boolean;
}) {
  return (
    <div className="flex size-full flex-col gap-2 lg:flex-row">
      <ScreenStage
        presenter={presenter}
        hideControls={immersive && !chrome}
        className={cn("flex-1", immersive && "rounded-none border-0")}
      />

      {!immersive && (
        <div className="scrollbar-hide flex h-28 shrink-0 flex-row gap-2 overflow-auto lg:h-auto lg:w-56 lg:flex-col">
          {people.map((p) => (
            <Tile
              key={p.id}
              person={p}
              speaking={p.id === speaking}
              compact
              className="aspect-3/4 h-full shrink-0 lg:aspect-video lg:h-auto lg:w-full"
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Media query como booleano. */
function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    on();
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Com o celular deitado, os controles somem sozinhos e voltam ao toque. */
function useIdleChrome(active: boolean) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!active) {
      setVisible(true);
      return;
    }
    let id = 0;
    const wake = () => {
      setVisible(true);
      window.clearTimeout(id);
      id = window.setTimeout(() => setVisible(false), 3000);
    };
    wake();
    document.addEventListener("pointerdown", wake);
    document.addEventListener("pointermove", wake);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", wake);
      document.removeEventListener("pointermove", wake);
    };
  }, [active]);
  return visible;
}
