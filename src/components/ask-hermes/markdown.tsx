"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Rendu Markdown des réponses de Hermes, en éléments React (jamais de HTML
 * brut injecté). Couvre ce qu'un agent écrit vraiment : titres, paragraphes,
 * listes, blocs de code, citations, tableaux, gras, italique, code en ligne,
 * liens http(s). Le reste s'affiche tel quel.
 */

type Block =
  | { kind: "code"; lang: string; body: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; rows: string[][]; header: boolean }
  | { kind: "rule" }
  | { kind: "para"; text: string };

function splitBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].match(new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`))) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: "code", lang: fence[2] ?? "", body: body.join("\n") });
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      let header = false;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((cell) => cell.trim());
        if (rows.length === 1 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))) header = true;
        else rows.push(cells);
        i += 1;
      }
      blocks.push({ kind: "table", rows, header });
      continue;
    }
    const listMatch = line.match(/^\s*(?:([-*+])|(\d{1,3})[.)])\s+/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i];
        const start = current.match(/^\s*(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/);
        if (start && Boolean(start[2]) === ordered) {
          items.push(start[3]);
          i += 1;
        } else if (current.trim() && /^\s{2,}/.test(current) && items.length) {
          items[items.length - 1] += `\n${current.trim()}`;
          i += 1;
        } else break;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const text: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        text.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: text.join("\n") });
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^\s*(`{3,}|~{3,}|#{1,6}\s|>|\|.*\||(?:[-*+]|\d{1,3}[.)])\s)/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "para", text: para.join("\n") });
  }
  return blocks;
}

// Source d'une regex recréée à chaque appel : `inline` est récursif (gras dans une ligne) ; une instance
// globale partagée verrait son lastIndex remis à zéro par l'appel interne et bouclerait sans fin.
const INLINE_SOURCE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\((?:https?:\/\/|\/)[^)\s]+\))|(https?:\/\/[^\s<>)]+)/.source;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const paragraphs = text.split("\n");
  paragraphs.forEach((line, lineIndex) => {
    let last = 0;
    let match: RegExpExecArray | null;
    const pattern = new RegExp(INLINE_SOURCE, "g");
    while ((match = pattern.exec(line))) {
      if (match.index > last) out.push(line.slice(last, match.index));
      const key = `${keyPrefix}-${lineIndex}-${match.index}`;
      const token = match[0];
      if (match[1]) out.push(<code key={key} className="rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-700/70">{token.slice(1, -1)}</code>);
      else if (match[2] || match[3]) out.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>);
      else if (match[4] || match[5]) out.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>);
      else if (match[6]) {
        const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) out.push(<a key={key} href={link[2]} target="_blank" rel="noreferrer noopener" className="underline decoration-slate-400 underline-offset-2 hover:decoration-current">{inline(link[1], key)}</a>);
      } else if (match[7]) out.push(<a key={key} href={token} target="_blank" rel="noreferrer noopener" className="break-all underline decoration-slate-400 underline-offset-2">{token}</a>);
      last = match.index + token.length;
    }
    if (last < line.length) out.push(line.slice(last));
    if (lineIndex < paragraphs.length - 1) out.push(<br key={`${keyPrefix}-br-${lineIndex}`} />);
  });
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = splitBlocks(text);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case "code":
            return <CodeBlock key={key} lang={block.lang} body={block.body} />;
          case "heading": {
            const size = block.level <= 2 ? "text-[13.5px] font-semibold" : "text-[12.5px] font-semibold";
            return (
              <p key={key} className={`${size} mt-3 first:mt-0 text-slate-900 dark:text-slate-100`}>
                {inline(block.text, key)}
              </p>
            );
          }
          case "list":
            return block.ordered ? (
              <ol key={key} className="my-1.5 list-decimal space-y-0.5 pl-5">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key} className="my-1.5 list-disc space-y-0.5 pl-5">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={key} className="my-1.5 border-l-2 border-slate-300 pl-3 text-slate-600 dark:border-slate-600 dark:text-slate-300">
                {inline(block.text, key)}
              </blockquote>
            );
          case "table":
            return (
              <div key={key} className="my-2 overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-b border-slate-200 last:border-0 dark:border-slate-700">
                        {row.map((cell, cellIndex) => (
                          <Fragment key={cellIndex}>
                            {block.header && rowIndex === 0 ? (
                              <th className="px-2 py-1 text-left font-semibold">{inline(cell, `${key}-${rowIndex}-${cellIndex}`)}</th>
                            ) : (
                              <td className="px-2 py-1 align-top">{inline(cell, `${key}-${rowIndex}-${cellIndex}`)}</td>
                            )}
                          </Fragment>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "rule":
            return <hr key={key} className="my-2 border-slate-200 dark:border-slate-700" />;
          case "para":
          default:
            return (
              <p key={key} className="my-1.5 first:mt-0 last:mb-0">
                {inline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}

function CodeBlock({ lang, body }: { lang: string; body: string }) {
  return (
    <div className="group/code relative my-2">
      <pre className="overflow-x-auto rounded-lg bg-slate-900 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-slate-100 dark:bg-slate-950">
        <code>{body}</code>
      </pre>
      <div className="pointer-events-none absolute right-2 top-1.5 flex items-center gap-1 text-[10px] text-slate-400">
        {lang ? <span>{lang}</span> : null}
        <CopyText text={body} />
      </div>
    </div>
  );
}

export function CopyText({ text, className }: { text: string; className?: string }) {
  return (
    <button
      type="button"
      className={className ?? "pointer-events-auto rounded border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-300 opacity-0 transition-opacity hover:bg-slate-700 group-hover/code:opacity-100 focus-visible:opacity-100"}
      onClick={(event) => {
        const button = event.currentTarget;
        void navigator.clipboard.writeText(text).then(() => {
          const previous = button.textContent;
          button.textContent = "Copied";
          setTimeout(() => {
            button.textContent = previous;
          }, 1200);
        });
      }}
    >
      Copy
    </button>
  );
}
