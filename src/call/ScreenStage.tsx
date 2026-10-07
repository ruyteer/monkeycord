import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Minimize, RotateCw, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Person } from "./useCall";
import { useZoomPan } from "./useZoomPan";
import { Video } from "./Video";

type Props = { presenter: Person; className?: string; /** some junto com os controles da chamada */ hideControls?: boolean };

type ScreenOrientationLock = ScreenOrientation & {
  lock?: (o: "landscape" | "portrait") => Promise<void>;
};

/**
 * Tela compartilhada com pinça pra dar zoom, arrastar pra mover e
 * "deitar a tela" no celular:
 * 1º tenta tela cheia + travar na horizontal (Android/Chrome);
 * se o navegador não deixar (iPhone), gira a imagem 90° por CSS.
 */
export function ScreenStage({ presenter, className, hideControls }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [rotated, setRotated] = useState(false);
  const { ref, t, reset, zoomAt, zoomed } = useZoomPan(true, rotated);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFull = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await box.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const lie = useCallback(async () => {
    const orientation = screen.orientation as ScreenOrientationLock | undefined;
    if (rotated || document.fullscreenElement) {
      orientation?.unlock?.();
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      setRotated(false);
      reset();
      return;
    }
    // 1ª tentativa: tela cheia travada na horizontal (Android/Chrome)
    try {
      await box.current!.requestFullscreen();
    } catch {
      /* iPhone não deixa uma div em tela cheia */
    }
    const deitou = () => innerWidth > innerHeight;
    if (document.fullscreenElement) {
      try {
        await orientation!.lock!("landscape");
      } catch {
        /* sem trava de orientação */
      }
      // Em tela cheia já deitado está resolvido
      if (deitou()) return reset();
      await document.exitFullscreen().catch(() => {});
    }
    // 2ª tentativa: gira a imagem na mão (iPhone e quem não trava orientação)
    setRotated(!deitou());
    reset();
  }, [rotated, reset]);

  const zoomBtn = (factor: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
  };

  const overlay = (
    <>
      <div
        className={cn(
          "pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium backdrop-blur-md",
          rotated && "hidden"
        )}
      >
        <span className="size-1.5 rounded-full bg-sky-400" />
        {presenter.isSelf ? "Você está apresentando" : `${presenter.name} está apresentando`}
        {zoomed && <span className="text-white/60">· {t.scale.toFixed(1)}×</span>}
      </div>

      <div
        className={cn(
          "absolute top-3 right-3 flex gap-1.5 transition-opacity duration-300",
          // no celular ficam sempre à vista; no computador aparecem ao passar o mouse
          "opacity-100 hover-fine:opacity-0 hover-fine:group-hover:opacity-100",
          hideControls && "pointer-events-none opacity-0",
          rotated && "top-auto bottom-3"
        )}
      >
        {zoomed && (
          <StageButton label="Voltar ao tamanho normal" onClick={reset}>
            <Scan />
          </StageButton>
        )}
        <StageButton label="Afastar" onClick={() => zoomBtn(1 / 1.4)}>
          <ZoomOut />
        </StageButton>
        <StageButton label="Aproximar" onClick={() => zoomBtn(1.4)}>
          <ZoomIn />
        </StageButton>
        <StageButton
          label={rotated || full ? "Voltar a tela" : "Deitar a tela"}
          onClick={lie}
          className={cn("hover-fine:hidden", (rotated || full) && "bg-sky-400/90 text-black")}
        >
          <RotateCw />
        </StageButton>
        <StageButton label="Tela cheia" onClick={toggleFull} className="hover-coarse:hidden">
          {full ? <Minimize /> : <Maximize />}
        </StageButton>
      </div>
    </>
  );

  const center = (
    <div
      ref={ref}
      className="size-full touch-none overflow-hidden"
      style={{ cursor: zoomed ? "grab" : "default" }}
    >
      <div
        className="size-full origin-center transition-transform duration-75 ease-out"
        style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})` }}
      >
        <Video track={presenter.screenVideo} fit="contain" main autoPip />
      </div>
    </div>
  );

  return (
    <div
      ref={box}
      className={cn(
        "group relative min-h-0 overflow-hidden rounded-xl border border-white/6 bg-black",
        full && "rounded-none",
        // girado na mão: cobre a tela toda, senão a moldura cortaria a imagem
        rotated && "fixed inset-0 z-50 rounded-none border-0",
        className
      )}
    >
      {rotated ? (
        // Imagem deitada: troca largura por altura e gira em volta do próprio centro.
        // Os botões ficam dentro, pra virarem junto quando você deita o celular.
        <div className="absolute top-1/2 left-1/2 h-[100vw] w-[100dvh] -translate-x-1/2 -translate-y-1/2 rotate-90">
          {center}
          {overlay}
        </div>
      ) : (
        <>
          {center}
          {overlay}
        </>
      )}
    </div>
  );
}


function StageButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      aria-label={label}
      title={label}
      size="icon-lg"
      variant="secondary"
      onClick={onClick}
      className={cn("rounded-full bg-black/60 backdrop-blur-md hover:bg-black/80", className)}
    >
      {children}
    </Button>
  );
}
