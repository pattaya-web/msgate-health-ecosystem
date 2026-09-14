/**
 * Repère, dans une réponse de Hermes, les prompts de génération prêts à
 * l'emploi : chaque bloc de code ``` est un prompt candidat, l'angle et
 * l'accroche sont lus sur les lignes qui l'entourent quand Hermes les a
 * écrites (« Angle: … », « Hook: … », « **1. Angle: X** | … »).
 * Sans dépendance : testable avec node directement.
 */

export type ExtractedPrompt = {
  id: string;
  prompt: string;
  angle?: string;
  hook?: string;
  label?: string;
};

const MIN_LENGTH = 40;
const CODE_HINTS = /^\s*(import |export |const |let |function |\{|\}|<\/?[a-z]+>|#!|SELECT |\$ )|;\s*$/m;

function clean(value: string) {
  return value.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
}

function angleFrom(lines: string[]): { angle?: string; label?: string } {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i -= 1) {
    const line = clean(lines[i]);
    if (!line) continue;
    const angle = line.match(/angle\s*[:：]\s*([^|•·—]+)/i);
    if (angle) return { angle: angle[1].trim().slice(0, 120), label: line.slice(0, 120) };
    const numbered = line.match(/^\d+[.)]\s*(.+)$/);
    if (numbered) return { angle: numbered[1].split(/[|•·—]/)[0].trim().slice(0, 120), label: line.slice(0, 120) };
    if (/^[A-Z#]/.test(line) && line.length <= 120) return { label: line };
  }
  return {};
}

function hookFrom(lines: string[]): string | undefined {
  for (const raw of lines.slice(0, 4)) {
    const line = clean(raw);
    const hook = line.match(/hook\s*[:：]\s*["“«]?(.+?)["”»]?\s*(\(.*\))?$/i);
    if (hook) return hook[1].trim().slice(0, 300);
  }
  return undefined;
}

export function extractPrompts(text: string): ExtractedPrompt[] {
  const out: ExtractedPrompt[] = [];
  const fence = /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = fence.exec(text))) {
    const body = match[3].trim();
    index += 1;
    if (body.length < MIN_LENGTH || CODE_HINTS.test(body)) continue;
    const before = text.slice(0, match.index).split("\n");
    const after = text.slice(match.index + match[0].length).split("\n");
    const { angle, label } = angleFrom(before);
    out.push({ id: `p${index}`, prompt: body, angle, hook: hookFrom(after), label });
  }
  return out;
}
