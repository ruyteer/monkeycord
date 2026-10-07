import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Controls } from "./Controls";
import type { Meeting } from "./meeting";
import { Tile } from "./Tile";
import type { Person } from "./useCall";
import { Video } from "./Video";

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(opts?: { width?: number; height?: number }): Promise<Window>;
      window: Window | null;
    };
  }
}

export const hasDocPip = typeof window !== "undefined" && "documentPictureInPicture" in window;

/**
 * Janela flutuante estilo Google Meet (Document Picture-in-Picture).
 * - Chrome/Edge: abre sozinha quando você troca de aba (mediaSession
 *   "enterpictureinpicture"), e também pelo botão.
 * - Outros navegadores: cai no PiP do próprio <video>.
 */
export function usePip() {
  const [win, setWin] = useState<Window | null>(null);

  const open = useCallback(async () => {
    const videoPip = () => {
      const v = document.querySelector<HTMLVideoElement>("video[data-main]") ?? document.querySelector("video");
      if (v && document.pictureInPictureEnabled) v.requestPictureInPicture().catch(() => {});
    };
    if (!hasDocPip) return videoPip();
    if (window.documentPictureInPicture!.window) return;
    let w: Window;
    try {
      w = await window.documentPictureInPicture!.requestWindow({ width: 340, height: 420 });
    } catch {
      return videoPip();
    }

    // Leva o CSS da página pra janela nova
    const base = w.document.createElement("base");
    base.href = location.origin + "/";
    w.document.head.append(base);
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const style = w.document.createElement("style");
        style.textContent = Array.from(sheet.cssRules, (r) => r.cssText).join("\n");
        w.document.head.append(style);
      } catch {
        if (sheet.href) {
          const link = w.document.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          w.document.head.append(link);
        }
      }
    }
    w.document.documentElement.className = "dark";
    w.document.title = "MonkeyCord";
    w.addEventListener("pagehide", () => setWin(null));
    setWin(w);
  }, []);

  const close = useCallback(() => {
    window.documentPictureInPicture?.window?.close();
    setWin(null);
  }, []);

  // Abre sozinho ao trocar de aba (Chrome 120+, com câmera/mic em uso)
  useEffect(() => {
    try {
      navigator.mediaSession.setActionHandler("enterpictureinpicture" as MediaSessionAction, () => {
        open();
      });
    } catch {
      /* navegador não suporta */
    }
    return () => {
      try {
        navigator.mediaSession.setActionHandler("enterpictureinpicture" as MediaSessionAction, null);
      } catch {
        /* ignore */
      }
      window.documentPictureInPicture?.window?.close();
    };
  }, [open]);

  return { win, open, close };
}

type ViewProps = {
  win: Window;
  meeting: Meeting;
  me: Person;
  others: Person[];
  presenter: Person | null;
  speaking: string | null;
  onLeave: () => void;
};

export function PipView({ win, meeting, me, others, presenter, speaking, onLeave }: ViewProps) {
  // Quem falou por último primeiro; no máximo 4 quadros
  const shown = (others.length ? others : [me])
    .slice()
    .sort((a, b) => Number(b.id === speaking) - Number(a.id === speaking))
    .slice(0, presenter ? 2 : 4);
  const cols = shown.length > 1 ? 2 : 1;

  return createPortal(
    <div className="flex h-dvh flex-col gap-2 bg-background p-2 text-foreground">
      <div className="min-h-0 flex-1">
        {presenter ? (
          <div className="flex h-full flex-col gap-2">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
              <Video track={presenter.screenVideo} fit="contain" />
            </div>
            <div className="grid h-20 grid-cols-2 gap-2">
              {shown.map((p) => (
                <Tile key={p.id} person={p} speaking={p.id === speaking} compact />
              ))}
            </div>
          </div>
        ) : (
          <div
            className="grid h-full gap-2"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {shown.map((p) => (
              <Tile key={p.id} person={p} speaking={p.id === speaking} compact={shown.length > 1} />
            ))}
          </div>
        )}
      </div>
      <Controls meeting={meeting} me={me} onLeave={onLeave} compact />
    </div>,
    win.document.body
  );
}
