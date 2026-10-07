import { useCallback, useEffect, useRef, useState } from "react";

export type Transform = { scale: number; x: number; y: number };
const RESET: Transform = { scale: 1, x: 0, y: 0 };
const MAX = 5;

/**
 * Pinça pra dar zoom e arrastar pra mover, igual num vídeo do Discord.
 * Também funciona no computador: roda do mouse dá zoom e clique-arrasta move.
 * O zoom acontece em volta dos dedos (ou do cursor), não do centro da tela.
 */
export function useZoomPan(enabled = true, rotated = false) {
  const ref = useRef<HTMLDivElement>(null);
  // Com a tela deitada o conteúdo está girado 90°: o dedo anda na tela, mas a
  // imagem precisa andar no sistema de coordenadas dela.
  const rot = useRef(rotated);
  rot.current = rotated;
  const toLocal = (dx: number, dy: number) => (rot.current ? { x: dy, y: -dx } : { x: dx, y: dy });
  const localSize = (r: DOMRect) =>
    rot.current ? { w: r.height, h: r.width } : { w: r.width, h: r.height };
  const [t, setT] = useState<Transform>(RESET);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const tap = useRef<{ x: number; y: number; at: number; alone: boolean } | null>(null);
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const lastTap = useRef(0);

  const reset = useCallback(() => setT(RESET), []);

  // Não deixa a imagem escapar da moldura
  const clamp = useCallback((next: Transform): Transform => {
    const el = ref.current;
    const scale = Math.min(MAX, Math.max(1, next.scale));
    if (!el || scale === 1) return { scale, x: 0, y: 0 };
    const { w, h } = localSize(el.getBoundingClientRect());
    const maxX = ((scale - 1) * w) / 2;
    const maxY = ((scale - 1) * h) / 2;
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, []);

  /** Zoom mantendo fixo o ponto (px, py) da tela. */
  const zoomAt = useCallback(
    (factor: number, px: number, py: number) =>
      setT((prev) => {
        const el = ref.current;
        if (!el) return prev;
        const r = el.getBoundingClientRect();
        const { x: ox, y: oy } = toLocal(px - (r.left + r.width / 2), py - (r.top + r.height / 2));
        const scale = Math.min(MAX, Math.max(1, prev.scale * factor));
        const k = scale / prev.scale;
        return clamp({ scale, x: ox - (ox - prev.x) * k, y: oy - (oy - prev.y) * k });
      }),
    [clamp]
  );

  // espelho do estado, pra ler dentro dos ouvintes sem recriá-los
  const current = useRef(t);
  current.current = t;

  const toggleZoom = useCallback(
    (px: number, py: number) => {
      if (current.current.scale > 1) setT(RESET);
      else zoomAt(2.5, px, py);
    },
    [zoomAt]
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const down = (e: PointerEvent) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tap.current =
        pointers.current.size === 1
          ? { x: e.clientX, y: e.clientY, at: Date.now(), alone: true }
          : tap.current && { ...tap.current, alone: false };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* alguns navegadores recusam; o zoom continua funcionando */
      }
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinch.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
        };
      }
    };

    const move = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size >= 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        zoomAt(dist / pinch.current.dist, cx, cy);
        // dois dedos juntos também arrastam
        const d = toLocal(cx - pinch.current.cx, cy - pinch.current.cy);
        setT((p) => clamp({ ...p, x: p.x + d.x, y: p.y + d.y }));
        pinch.current = { dist, cx, cy };
        e.preventDefault();
        return;
      }

      // um dedo só move quando já está com zoom
      const d = toLocal(e.clientX - prev.x, e.clientY - prev.y);
      setT((p) => {
        if (p.scale <= 1) return p;
        e.preventDefault();
        return clamp({ ...p, x: p.x + d.x, y: p.y + d.y });
      });
    };

    const up = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      // Dois toques rápidos aproximam/afastam — mas só se foi toque mesmo:
      // um dedo só, parado e rápido (arrastar ou pinçar não conta).
      const t0 = tap.current;
      const isTap =
        e.pointerType === "touch" &&
        !!t0?.alone &&
        Date.now() - t0.at < 250 &&
        Math.hypot(e.clientX - t0.x, e.clientY - t0.y) < 10;
      tap.current = null;
      if (!isTap) return;
      const now = Date.now();
      if (now - lastTap.current < 300) {
        toggleZoom(e.clientX, e.clientY);
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move, { passive: false });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
    };
  }, [enabled, zoomAt, clamp, toggleZoom]);

  return { ref, t, reset, zoomAt, zoomed: t.scale > 1.01 };
}
