import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { desktop, type UpdateState } from "@/desktop";
import { Tip } from "./ServerRail";

/**
 * Barra de título do app desktop, igual à do Discord: fininha, com o nome à
 * esquerda e os botões do Windows (desenhados pelo próprio Windows) à direita.
 * Quando tem atualização pronta, aparece a setinha verde.
 */
export function TitleBar() {
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  useEffect(() => desktop?.onUpdate(setUpdate), []);
  if (!desktop) return null;
  return (
    <div className="app-drag flex h-[22px] shrink-0 items-center bg-rail pl-3 text-[12px] font-bold text-muted-foreground select-none">
      <span className="font-display text-[13px] tracking-wide text-foreground/70">MonkeyCord</span>
      {update.status === "ready" && (
        <Tip label={`Versão ${update.version} pronta: clique pra reiniciar`} side="bottom">
          <button type="button" onClick={() => desktop!.installUpdate()} className="app-no-drag ml-auto mr-[150px] flex items-center text-success">
            <Download className="size-4" />
          </button>
        </Tip>
      )}
    </div>
  );
}
