import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shell } from "./shell/Shell";

export default function App() {
  const [name, setName] = useState(() => safeGet("nome"));
  const [inviteRoom] = useState(() => new URLSearchParams(location.search).get("sala") ?? undefined);

  if (name)
    return (
      <Shell
        name={name}
        inviteRoom={inviteRoom}
        onLogout={() => {
          safeSet("nome", "");
          setName("");
        }}
      />
    );

  return (
    <div className="lobby-glow flex h-full flex-col items-center justify-center overflow-y-auto px-4 py-8">
      <Lobby
        invite={inviteRoom}
        onReady={(n) => {
          safeSet("nome", n);
          setName(n);
        }}
      />
    </div>
  );
}

function Lobby({ invite, onReady }: { invite?: string; onReady: (name: string) => void }) {
  const [name, setName] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) onReady(name.trim());
  };

  return (
    <div className="flex w-full max-w-sm flex-col items-center">
      <h1 className="chrome-title hero-in text-7xl sm:text-8xl">MonkeyCord</h1>
      <p className="hero-in mt-2 mb-8 text-center text-balance text-muted-foreground" style={{ "--d": "0.1s" } as React.CSSProperties}>
        {invite ? (
          <>
            Te chamaram pra <b className="text-foreground">{invite}</b>. Só colocar o nome.
          </>
        ) : (
          "Chat, voz e tela com a galera. Só colocar o nome."
        )}
      </p>

      <form
        onSubmit={submit}
        className="hero-in flex w-full flex-col gap-3 rounded-2xl border bg-card p-4 backdrop-blur-sm sm:p-5"
        style={{ "--d": "0.2s" } as React.CSSProperties}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Seu nome</span>
          <Input
            inputSize="lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como a galera te chama"
            maxLength={40}
            autoFocus
            required
          />
        </label>
        <Button type="submit" variant="liquid-metal" size="cta" disabled={!name.trim()} className="mt-2 w-full">
          <ArrowRight />
          Entrar
        </Button>
      </form>
    </div>
  );
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}
function safeSet(k: string, v: string) {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* modo privado */
  }
}
