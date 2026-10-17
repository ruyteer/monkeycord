import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BellRing, Download, Keyboard, Laptop, Mic, Monitor, RefreshCw, User, X } from "lucide-react";
import { toast } from "sonner";
import { getPrefs, listDevices, micConstraints, setPrefs, usePrefs, cameraConstraints } from "@/call/devices";
import type { Meeting } from "@/call/meeting";
import type { Status } from "@/chat/protocol";
import { setStatus, useMyStatus } from "@/chat/store";
import { desktop, type DesktopSettings, type UpdateState } from "@/desktop";
import { cn } from "@/lib/utils";
import { Avatar, StatusDot, statusLabel } from "./Avatar";

type Tab = "conta" | "voz" | "notificacoes" | "atalhos" | "app";

/* Abrir de qualquer lugar: openSettings("voz") */
let openTab: Tab | null = null;
const listeners = new Set<() => void>();
export function openSettings(tab: Tab = "conta") {
  openTab = tab;
  listeners.forEach((l) => l());
}
function closeSettings() {
  openTab = null;
  listeners.forEach((l) => l());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** Configurações de usuário em tela cheia, igual ao Discord (Esc fecha). */
export function SettingsHost({ name, meeting, onLogout }: { name: string; meeting: Meeting | null; onLogout: () => void }) {
  const tab = useSyncExternalStore(subscribe, () => openTab);
  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSettings();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);
  if (!tab) return null;

  const items: { id: Tab; label: string; icon: ReactNode; desktop?: boolean }[] = [
    { id: "conta", label: "Minha conta", icon: <User /> },
    { id: "voz", label: "Voz e vídeo", icon: <Mic /> },
    { id: "notificacoes", label: "Notificações", icon: <BellRing /> },
    { id: "atalhos", label: "Atalhos de teclado", icon: <Keyboard /> },
    { id: "app", label: desktop ? "Windows e atualizações" : "App pra Windows", icon: <Laptop /> },
  ];

  return (
    // No app desktop fica embaixo da barra de título (pra continuar dando pra arrastar a janela)
    <div className={cn("fixed inset-x-0 bottom-0 z-40 flex bg-main animate-in fade-in zoom-in-[0.98] duration-150", desktop ? "top-[22px]" : "top-0")}>
      <nav className="flex w-[218px] shrink-0 justify-end overflow-y-auto bg-sidebar py-14 pr-2 pl-5 max-md:w-16 max-md:pl-2">
        <div className="w-48 max-md:w-auto">
          <p className="px-2.5 pb-1.5 text-xs font-bold tracking-wide text-muted-foreground uppercase max-md:hidden">Configurações de usuário</p>
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => openSettings(it.id)}
              className={cn(
                "mb-0.5 flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[15px] font-medium [&_svg]:size-4.5",
                tab === it.id ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              {it.icon}
              <span className="truncate max-md:hidden">{it.label}</span>
            </button>
          ))}
          <div className="my-2 h-px bg-white/8" />
          <button
            type="button"
            onClick={() => {
              closeSettings();
              onLogout();
            }}
            className="flex h-8 w-full items-center rounded-md px-2.5 text-[15px] font-medium text-destructive hover:bg-destructive/10"
          >
            <span className="max-md:hidden">Sair</span>
            <span className="md:hidden">⏻</span>
          </button>
        </div>
      </nav>
      <main className="scrollbar-thin min-w-0 flex-1 overflow-y-auto px-10 py-14 max-md:px-4">
        <div className="mx-auto max-w-[740px]">
          {tab === "conta" && <Account name={name} onLogout={onLogout} />}
          {tab === "voz" && <VoiceVideo meeting={meeting} />}
          {tab === "notificacoes" && <Notifications />}
          {tab === "atalhos" && <Shortcuts />}
          {tab === "app" && <AppTab />}
        </div>
      </main>
      <div className="absolute top-14 right-10 flex flex-col items-center gap-1 max-md:top-3 max-md:right-3">
        <button
          type="button"
          aria-label="Fechar"
          onClick={closeSettings}
          className="flex size-9 items-center justify-center rounded-full border-2 border-white/30 text-muted-foreground hover:border-white/60 hover:text-foreground"
        >
          <X className="size-5" />
        </button>
        <span className="text-xs font-semibold text-muted-foreground max-md:hidden">ESC</span>
      </div>
    </div>
  );
}

function H1({ children }: { children: ReactNode }) {
  return <h2 className="mb-5 text-xl font-bold">{children}</h2>;
}
function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">{children}</p>;
}
function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("mb-8", className)}>{children}</section>;
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-6 border-b border-white/6 py-4">
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-sm text-muted-foreground">{hint}</span>}
      </span>
      <span className={cn("relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors", checked ? "bg-success" : "bg-white/20")}>
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </span>
    </label>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-md border border-white/8 bg-rail px-3 text-sm outline-none focus:border-white/30"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Slider({ value, onChange, max = 200 }: { value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 flex-1 accent-foreground" />
      <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">{value}%</span>
    </div>
  );
}

function Account({ name, onLogout }: { name: string; onLogout: () => void }) {
  const status = useMyStatus();
  return (
    <>
      <H1>Minha conta</H1>
      <div className="overflow-hidden rounded-xl bg-sidebar">
        <div className="h-24 bg-linear-to-r from-white/10 to-white/3" />
        <div className="flex items-end gap-4 px-4 pb-4">
          <Avatar name={name} size={80} status={status === "invisible" ? "offline" : status} ring="var(--mc-sidebar)" className="-mt-10 rounded-full ring-[6px] ring-sidebar" />
          <div className="min-w-0 flex-1 pb-1">
            <p className="truncate text-xl font-bold">{name}</p>
            <p className="text-sm text-muted-foreground">{statusLabel[status]}</p>
          </div>
          <button type="button" onClick={onLogout} className="mb-1 h-9 rounded-md bg-white/10 px-4 text-sm font-semibold hover:bg-white/15">
            Trocar de nome
          </button>
        </div>
      </div>
      <Section className="mt-8">
        <Label>Status</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["online", "idle", "dnd", "invisible"] as Status[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left", status === s ? "border-white/40 bg-white/8" : "border-white/8 hover:bg-white/5")}
            >
              <StatusDot status={s} size={12} ring="var(--mc-main)" />
              {statusLabel[s]}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

function VoiceVideo({ meeting }: { meeting: Meeting | null }) {
  const prefs = usePrefs();
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof listDevices>> | null>(null);
  const refresh = () => listDevices().then(setDevices);
  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refresh);
  }, []);

  const opts = (list: MediaDeviceInfo[] | undefined, fallback: string) => [
    { value: "default", label: "Padrão do sistema" },
    ...(list ?? [])
      .filter((d) => d.deviceId && d.deviceId !== "default")
      .map((d, i) => ({ value: d.deviceId, label: d.label || `${fallback} ${i + 1}` })),
  ];

  // Mudou algo do microfone com a chamada aberta: troca na hora
  const micChanged = (change: Parameters<typeof setPrefs>[0]) => {
    setPrefs(change);
    void meeting?.restartMic().catch(() => toast.error("Não deu pra trocar o microfone"));
  };

  return (
    <>
      <H1>Voz e vídeo</H1>
      <Section className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label>Dispositivo de entrada</Label>
          <Select value={prefs.micId} onChange={(v) => micChanged({ micId: v })} options={opts(devices?.mics, "Microfone")} />
        </div>
        <div>
          <Label>Dispositivo de saída</Label>
          <Select value={prefs.speakerId} onChange={(v) => setPrefs({ speakerId: v })} options={opts(devices?.speakers, "Saída")} />
        </div>
        <div>
          <Label>Volume de entrada</Label>
          <Slider value={prefs.inputGain} onChange={(v) => setPrefs({ inputGain: v })} />
        </div>
        <div>
          <Label>Volume de saída</Label>
          <Slider value={prefs.outputVolume} onChange={(v) => setPrefs({ outputVolume: v })} max={100} />
        </div>
      </Section>
      {devices && !devices.mics.some((d) => d.label) && (
        <p className="-mt-4 mb-6 text-sm text-muted-foreground">Os nomes dos aparelhos aparecem depois que você testar o microfone uma vez.</p>
      )}

      <Section>
        <Label>Teste de microfone</Label>
        <p className="mb-3 text-sm text-muted-foreground">Fale alguma coisa: a barra mostra o volume que os outros recebem.</p>
        <MicTest onDevices={refresh} />
      </Section>

      <Section>
        <Label>Processamento de voz</Label>
        <Toggle label="Supressão de ruído" hint="Corta barulho de fundo (ventilador, teclado)." checked={prefs.noiseSuppression} onChange={(v) => micChanged({ noiseSuppression: v })} />
        <Toggle label="Cancelamento de eco" hint="Evita que os outros se ouçam pelas suas caixas de som." checked={prefs.echoCancellation} onChange={(v) => micChanged({ echoCancellation: v })} />
        <Toggle label="Controle automático de ganho" hint="Ajusta sozinho o volume do microfone." checked={prefs.autoGain} onChange={(v) => micChanged({ autoGain: v })} />
        <Toggle label="Sons da voz" hint="Bipes ao entrar, sair, mutar e desmutar." checked={prefs.sounds} onChange={(v) => setPrefs({ sounds: v })} />
      </Section>

      <Section>
        <Label>Câmera</Label>
        <Select value={prefs.cameraId} onChange={(v) => setPrefs({ cameraId: v })} options={opts(devices?.cameras, "Câmera")} />
        <CameraPreview cameraId={prefs.cameraId} />
      </Section>
    </>
  );
}

function MicTest({ onDevices }: { onDevices: () => void }) {
  const [on, setOn] = useState(false);
  const [level, setLevel] = useState(0);
  const stop = useRef<() => void>(() => {});

  useEffect(() => () => stop.current(), []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
      onDevices();
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = getPrefs().inputGain / 100;
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(gain).connect(an);
      const buf = new Uint8Array(512);
      let raf = 0;
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        setLevel(Math.min(100, Math.sqrt(sum / buf.length) * 3));
        raf = requestAnimationFrame(loop);
      };
      loop();
      stop.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        setLevel(0);
        setOn(false);
      };
      setOn(true);
    } catch {
      toast.error("Não deu pra abrir o microfone", { description: "Confira a permissão do navegador/Windows." });
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => (on ? stop.current() : void start())}
        className={cn("h-9 shrink-0 rounded-md px-4 text-sm font-semibold", on ? "bg-white/10 hover:bg-white/15" : "bg-foreground text-background hover:bg-foreground/85")}
      >
        {on ? "Parar teste" : "Vamos testar"}
      </button>
      <div className="flex h-2 flex-1 gap-[3px]">
        {Array.from({ length: 40 }, (_, i) => (
          <span key={i} className={cn("flex-1 rounded-sm transition-colors", (i / 40) * 100 < level ? (i > 32 ? "bg-warning" : "bg-success") : "bg-white/10")} />
        ))}
      </div>
    </div>
  );
}

function CameraPreview({ cameraId }: { cameraId: string }) {
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: cameraConstraints(false) })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (ref.current) ref.current.srcObject = s;
      })
      .catch(() => {
        toast.error("Não deu pra abrir a câmera");
        setOn(false);
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on, cameraId]);
  return (
    <div className="mt-3 flex aspect-video max-w-md items-center justify-center overflow-hidden rounded-lg bg-black">
      {on ? (
        <video ref={ref} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />
      ) : (
        <button type="button" onClick={() => setOn(true)} className="h-9 rounded-md bg-white/10 px-4 text-sm font-semibold hover:bg-white/15">
          Testar câmera
        </button>
      )}
    </div>
  );
}

function Notifications() {
  const [perm, setPerm] = useState(() => ("Notification" in window ? Notification.permission : "denied"));
  return (
    <>
      <H1>Notificações</H1>
      <Section>
        <div className="flex items-center justify-between gap-4 border-b border-white/6 py-4">
          <span>
            <span className="block font-medium">Notificações na área de trabalho</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              {perm === "granted" ? "Ligadas." : perm === "denied" ? "Bloqueadas pelo navegador/Windows." : "Ainda não liberadas."}
            </span>
          </span>
          {perm !== "granted" && "Notification" in window && (
            <button
              type="button"
              onClick={() => void Notification.requestPermission().then(setPerm)}
              className="h-9 shrink-0 rounded-md bg-foreground px-4 text-sm font-semibold text-background"
            >
              Ligar
            </button>
          )}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Pra escolher o que cada canal avisa (tudo, só @menções ou nada), use o sino no topo do canal ou clique com o botão direito nele.
          No status <b>Não perturbe</b> nada avisa.
        </p>
      </Section>
    </>
  );
}

const SHORTCUTS: [string, string, boolean?][] = [
  ["Ctrl + Shift + M", "Mutar / desmutar o microfone", true],
  ["Ctrl + Shift + D", "Ativar / desativar o áudio (surdo)", true],
  ["Ctrl + K", "Pular pra um canal ou conversa"],
  ["Alt + ↑ / ↓", "Canal anterior / próximo"],
  ["Esc", "Marcar o canal como lido / fechar"],
  ["↑ (caixa vazia)", "Editar sua última mensagem"],
  ["Shift + Enter", "Nova linha"],
  ["Shift + clique na lixeira", "Apagar sem perguntar"],
];

function Shortcuts() {
  return (
    <>
      <H1>Atalhos de teclado</H1>
      <div className="divide-y divide-white/6 rounded-lg border border-white/8">
        {SHORTCUTS.map(([keys, what, global]) => (
          <div key={keys} className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="text-sm">
              {what}
              {global && desktop && <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-semibold text-success">funciona com o app minimizado</span>}
            </span>
            <kbd className="shrink-0 rounded-md border border-white/15 bg-rail px-2 py-1 font-mono text-xs">{keys}</kbd>
          </div>
        ))}
      </div>
    </>
  );
}

function AppTab() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  useEffect(() => {
    if (!desktop) return;
    void desktop.getSettings().then(setSettings);
    void desktop.info().then((i) => setVersion(i.version));
    return desktop.onUpdate(setUpdate);
  }, []);

  if (!desktop) {
    return (
      <>
        <H1>App pra Windows</H1>
        <div className="flex items-start gap-4 rounded-xl border border-white/8 bg-sidebar p-5">
          <Monitor className="size-10 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-semibold">Use o MonkeyCord instalado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No app a transmissão de tela leva o som do computador junto, os atalhos de mutar funcionam com ele minimizado,
              ele fica na bandeja e se atualiza sozinho.
            </p>
            <a
              href="https://github.com/ruyteer/monkeycord/releases/latest"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-semibold text-background"
            >
              <Download className="size-4" /> Baixar pra Windows
            </a>
          </div>
        </div>
      </>
    );
  }

  const change = (s: Partial<DesktopSettings>) => void desktop!.setSettings(s).then(setSettings);
  return (
    <>
      <H1>Windows e atualizações</H1>
      {settings && (
        <Section>
          <Toggle label="Abrir o MonkeyCord junto com o Windows" checked={settings.openAtLogin} onChange={(v) => change({ openAtLogin: v })} />
          <Toggle
            label="Ao fechar, deixar na bandeja"
            hint="O X só esconde a janela; o app continua rodando perto do relógio, igual ao Discord."
            checked={settings.closeToTray}
            onChange={(v) => change({ closeToTray: v })}
          />
          <Toggle
            label="Atalhos globais"
            hint="Ctrl+Shift+M e Ctrl+Shift+D funcionam mesmo com o MonkeyCord em segundo plano."
            checked={settings.globalShortcuts}
            onChange={(v) => change({ globalShortcuts: v })}
          />
        </Section>
      )}
      <Section>
        <Label>Versão</Label>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-white/8 px-4 py-3">
          <span className="text-sm">
            MonkeyCord <b>{version}</b>
            <span className="ml-2 text-muted-foreground">
              {update.status === "checking" && "· procurando atualização..."}
              {update.status === "none" && "· você está na versão mais nova"}
              {update.status === "available" && `· baixando a ${update.version}...`}
              {update.status === "downloading" && `· baixando ${Math.round(update.percent)}%`}
              {update.status === "ready" && `· a ${update.version} está pronta`}
              {update.status === "error" && "· não deu pra procurar agora"}
            </span>
          </span>
          {update.status === "ready" ? (
            <button type="button" onClick={() => desktop!.installUpdate()} className="h-9 rounded-md bg-success px-4 text-sm font-semibold text-black">
              Reiniciar e atualizar
            </button>
          ) : (
            <button type="button" onClick={() => desktop!.checkUpdates()} className="flex h-9 items-center gap-2 rounded-md bg-white/10 px-4 text-sm font-semibold hover:bg-white/15">
              <RefreshCw className="size-4" /> Procurar atualização
            </button>
          )}
        </div>
      </Section>
    </>
  );
}
