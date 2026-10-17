import { Fragment, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Formatação no estilo do Discord:
 * **negrito**, *itálico* ou _itálico_, __sublinhado__, ~~riscado~~, `código`,
 * ```bloco de código```, ||spoiler||, > citação, # título, links e @menções.
 */
export function Markdown({ text, me }: { text: string; me: string }) {
  const parts = text.split(/```(?:([\w+-]{1,20})\n)?([\s\S]*?)```/g);
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]) out.push(<Blocks key={i} text={parts[i]} me={me} />);
    if (i + 2 < parts.length) {
      out.push(
        <pre
          key={`c${i}`}
          className="my-1 max-w-full overflow-x-auto rounded-md border border-white/8 bg-black/40 p-2 font-mono text-[13px] leading-snug whitespace-pre"
        >
          <code>{parts[i + 2].replace(/^\n|\n$/g, "")}</code>
        </pre>
      );
    }
  }
  return <>{out}</>;
}

/** Linhas: citações (> ) e títulos (#, ##, ###). O resto é texto com formatação. */
function Blocks({ text, me }: { text: string; me: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let quote: string[] = [];
  // Quebra de linha só entre duas linhas de texto comum (bloco já quebra sozinho)
  let prevInline = false;
  const flushQuote = (key: number) => {
    if (!quote.length) return;
    out.push(
      <blockquote key={`q${key}`} className="my-0.5 border-l-4 border-white/20 pl-3">
        {quote.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && "\n"}
            <Inline text={l} me={me} />
          </Fragment>
        ))}
      </blockquote>
    );
    quote = [];
    prevInline = false;
  };
  lines.forEach((line, i) => {
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      quote.push(q[1]);
      return;
    }
    flushQuote(i);
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const size = ["text-2xl", "text-xl", "text-lg"][h[1].length - 1];
      out.push(
        <span key={i} className={cn("my-1 block font-bold", size)}>
          <Inline text={h[2]} me={me} />
        </span>
      );
      prevInline = false;
      return;
    }
    out.push(
      <Fragment key={i}>
        {prevInline && "\n"}
        <Inline text={line} me={me} />
      </Fragment>
    );
    prevInline = true;
  });
  flushQuote(lines.length);
  return <>{out}</>;
}

const RULES: { re: RegExp; render: (inner: ReactNode, raw: string, key: number) => ReactNode; raw?: boolean }[] = [
  { re: /`([^`\n]+)`/, raw: true, render: (_i, raw, k) => <code key={k} className="rounded bg-black/40 px-1 py-px font-mono text-[0.85em]">{raw}</code> },
  { re: /\|\|([\s\S]+?)\|\|/, render: (inner, _r, k) => <Spoiler key={k}>{inner}</Spoiler> },
  { re: /\*\*([\s\S]+?)\*\*/, render: (inner, _r, k) => <strong key={k} className="font-bold">{inner}</strong> },
  { re: /__([\s\S]+?)__/, render: (inner, _r, k) => <u key={k}>{inner}</u> },
  { re: /~~([\s\S]+?)~~/, render: (inner, _r, k) => <s key={k}>{inner}</s> },
  { re: /\*([^*\s][^*]*?)\*/, render: (inner, _r, k) => <em key={k}>{inner}</em> },
  { re: /(?<![\p{L}\p{N}])_([^_\s][^_]*?)_(?![\p{L}\p{N}])/u, render: (inner, _r, k) => <em key={k}>{inner}</em> },
];

function Inline({ text, me }: { text: string; me: string }): ReactNode {
  // Acha a formatação que começa primeiro e resolve o que tem dentro dela de novo
  let best: { index: number; length: number; inner: string; rule: (typeof RULES)[number] } | null = null;
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m && (!best || m.index < best.index)) best = { index: m.index, length: m[0].length, inner: m[1], rule };
  }
  if (!best) return <Plain text={text} me={me} />;
  const { index, length, inner, rule } = best;
  return (
    <>
      {index > 0 && <Plain text={text.slice(0, index)} me={me} />}
      {rule.render(rule.raw ? null : <Inline text={inner} me={me} />, inner, index)}
      {index + length < text.length && <Inline text={text.slice(index + length)} me={me} />}
    </>
  );
}

const TOKEN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]]|@[\p{L}\p{N}_.-]+)/gu;

/** Texto com links clicáveis e menções destacadas. */
function Plain({ text, me }: { text: string; me: string }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>;
        if (p.startsWith("@")) {
          const self = p.slice(1).toLowerCase() === me.toLowerCase() || /^@(everyone|todos)$/i.test(p);
          return (
            <span key={i} className={cn("rounded px-0.5 font-medium", self ? "bg-warning/25 text-warning" : "bg-white/10 text-foreground")}>
              {p}
            </span>
          );
        }
        return (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="text-sky-300 hover:underline">
            {p}
          </a>
        );
      })}
    </>
  );
}

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      title={open ? undefined : "Spoiler: clique pra ver"}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
      className={cn("rounded px-0.5 transition-colors", open ? "bg-white/10" : "cursor-pointer bg-zinc-600 text-transparent select-none hover:bg-zinc-500 [&_*]:invisible")}
    >
      {children}
    </span>
  );
}
