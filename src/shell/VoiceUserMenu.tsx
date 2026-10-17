import type { ReactElement } from "react";
import { MessageCircle, VolumeX } from "lucide-react";
import { getPrefs, setPrefs, usePrefs } from "@/call/devices";
import { ContextMenu, MenuItem, MenuLabel, MenuSeparator } from "./ui";

/** Clique direito em alguém da voz: volume só pra você, silenciar e mensagem. */
export function VoiceUserMenu({
  name,
  isSelf,
  onOpenDm,
  children,
}: {
  name: string;
  isSelf: boolean;
  onOpenDm?: (name: string) => void;
  children: ReactElement;
}) {
  return (
    <ContextMenu
      disabled={isSelf}
      menu={
        <>
          <MenuLabel>Volume do usuário</MenuLabel>
          <VolumeSlider id={name} />
          <MenuLabel>Volume da transmissão</MenuLabel>
          <VolumeSlider id={`${name} (tela)`} />
          <MenuSeparator />
          <LocalMute name={name} />
          {onOpenDm && (
            <MenuItem icon={<MessageCircle />} onClick={() => onOpenDm(name)}>
              Enviar mensagem
            </MenuItem>
          )}
        </>
      }
    >
      {children}
    </ContextMenu>
  );
}

function VolumeSlider({ id }: { id: string }) {
  const prefs = usePrefs();
  const value = prefs.userVolume[id] ?? 100;
  return (
    <div className="flex items-center gap-2 px-2 pb-2" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => setPrefs({ userVolume: { ...getPrefs().userVolume, [id]: Number(e.target.value) } })}
        className="h-1.5 flex-1 cursor-pointer accent-foreground"
        aria-label="Volume"
      />
      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{value}%</span>
    </div>
  );
}

function LocalMute({ name }: { name: string }) {
  const prefs = usePrefs();
  const muted = !!prefs.localMute[name];
  return (
    <MenuItem
      icon={<VolumeX />}
      className={muted ? "text-destructive" : undefined}
      onClick={() => setPrefs({ localMute: { ...getPrefs().localMute, [name]: !muted } })}
    >
      {muted ? "Tirar o silêncio" : "Silenciar pra mim"}
    </MenuItem>
  );
}
