import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import { buildPipeline, invalidatePipeline, type WindowDays } from "@/lib/creative-pipeline/build";
import { DEFAULT_THRESHOLDS, journalLine, updateStore, type Brief, type BriefStatus, type CreativeStatus, type Thresholds } from "@/lib/creative-pipeline/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BRIEF_STATUSES: BriefStatus[] = ["BRIEF", "EN PROD", "PRÊTE", "UPLOADÉE"];
const CREATIVE_STATUSES: CreativeStatus[] = ["TEST", "MAIN", "SCALING", "BIDCAP", "COSTCAP", "OFF"];
const clean = (value: unknown, max = 300) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const token = (value: string) => value.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, "");

function allowed(request: Request) {
  const session = sessionFromRequest(request);
  return session && (session.role === "admin" || session.role === "associate") ? session : null;
}

/** Le pipeline créa (admin et associée : le périmètre Venom). `window` = 3, 7 ou 14 jours complets. */
export async function GET(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const raw = Number(params.get("window"));
  const window: WindowDays = raw === 3 || raw === 14 ? raw : 7;
  try {
    return NextResponse.json({ ok: true, ...(await buildPipeline(window, params.get("refresh") === "1")) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pipeline indisponible" }, { status: 502 });
  }
}

/**
 * Les actions : `brief.save` (créer / modifier), `brief.move` (changer de colonne),
 * `brief.delete`, `status.set` (forcer le statut d'une créa, null = automatique),
 * `settings` (taux d'upsell, facteur réel, seuils), `check` (case de « À faire cette semaine »),
 * `log` (couper / promouvoir faits depuis le pipeline).
 */
export async function POST(request: Request) {
  const session = allowed(request);
  if (!session) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const who = session.email;
  /** Qui a coché une case : « Admin » ou « Alison » (le compte associé). */
  const person = session.role === "associate" ? "Alison" : "Admin";
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await updateStore((store) => {
      if (body.action === "brief.save") {
        const input = (body.brief ?? {}) as Partial<Brief>;
        const format = input.format === "V" ? "V" : "S";
        const concept = token(clean(input.concept, 40)) || "CONCEPT";
        const method = token(clean(input.method, 40)) || "METHODE";
        const existing = input.id ? store.briefs.find((brief) => brief.id === input.id) : null;
        const sameFamily = store.briefs.filter((brief) => brief.format === format && brief.concept === concept && brief.method === method && brief.id !== existing?.id);
        const version =
          existing && existing.format === format && existing.concept === concept && existing.method === method
            ? existing.version
            : Math.max(0, ...sameFamily.map((brief) => brief.version)) + 1;
        const status = BRIEF_STATUSES.includes(input.status as BriefStatus) ? (input.status as BriefStatus) : "BRIEF";
        const now = new Date().toISOString();
        const brief: Brief = {
          id: existing?.id ?? randomUUID(),
          creaId: `${format}_${concept}_${method}_v${version}`,
          format,
          concept,
          method,
          version,
          type: input.type === "Nouveau concept" ? "Nouveau concept" : "Itération",
          swap: clean(input.swap, 40),
          source: clean(input.source, 60),
          angle: clean(input.angle),
          headline: clean(input.headline),
          badge: clean(input.badge, 80),
          visual: clean(input.visual, 1200),
          price: clean(input.price, 80) || "29,99 $ barré 59,98 $",
          formats: Array.isArray(input.formats) ? input.formats.map((item) => clean(item, 10)).filter(Boolean).slice(0, 4) : ["3:4", "1:1"],
          targetAdset: clean(input.targetAdset, 120),
          deadline: clean(input.deadline, 20),
          assignee: clean(input.assignee, 40),
          status,
          postId: clean(input.postId, 60),
          createdAt: existing?.createdAt ?? now,
          createdBy: existing?.createdBy ?? who,
          statusAt: { ...(existing?.statusAt ?? { BRIEF: now }), ...(existing?.status !== status ? { [status]: now } : {}) },
        };
        if (existing) Object.assign(existing, brief);
        else store.briefs.push(brief);
        store.journal.push(journalLine(who, existing ? `Brief ${brief.creaId} modifié` : `Brief ${brief.creaId} créé (${brief.type})`));
        return { brief };
      }
      if (body.action === "brief.move") {
        const brief = store.briefs.find((row) => row.id === body.id);
        const status = body.status as BriefStatus;
        if (!brief || !BRIEF_STATUSES.includes(status)) throw new Error("Brief introuvable");
        store.journal.push(journalLine(who, `Brief ${brief.creaId} : ${brief.status} → ${status}`));
        brief.status = status;
        brief.statusAt = { ...brief.statusAt, [status]: new Date().toISOString() };
        return { brief };
      }
      if (body.action === "brief.delete") {
        const brief = store.briefs.find((row) => row.id === body.id);
        if (!brief) throw new Error("Brief introuvable");
        store.briefs = store.briefs.filter((row) => row.id !== body.id);
        store.journal.push(journalLine(who, `Brief ${brief.creaId} supprimé`));
        return { ok: true };
      }
      if (body.action === "status.set") {
        const key = clean(body.key, 120);
        const status = body.status == null ? null : (body.status as CreativeStatus);
        if (!key || (status && !CREATIVE_STATUSES.includes(status))) throw new Error("Statut invalide");
        const current = store.creatives[key] ?? { auto: null, manual: null, history: [] };
        current.history.push({
          at: new Date().toISOString(),
          who,
          from: current.manual ?? current.auto,
          to: status ?? current.auto ?? "OFF",
          note: status ? "forcé à la main" : "retour à l'automatique",
        });
        current.manual = status;
        store.creatives[key] = current;
        return { ok: true };
      }
      if (body.action === "settings") {
        if (body.upsellRate !== undefined) {
          const rate = body.upsellRate === null ? null : Number(body.upsellRate);
          store.settings.upsellRate = rate == null || !Number.isFinite(rate) ? null : Math.min(1, Math.max(0, rate));
          store.journal.push(journalLine(who, `Taux d'upsell : ${store.settings.upsellRate == null ? "par défaut (10 %)" : `${Math.round(store.settings.upsellRate * 100)} %`}`));
        }
        if (body.factor !== undefined) {
          const factor = body.factor === null ? null : Number(body.factor);
          store.settings.factor = factor == null || !Number.isFinite(factor) || factor <= 0 ? null : Math.round(factor * 100) / 100;
          store.journal.push(journalLine(who, `Facteur réel : ${store.settings.factor == null ? "calculé" : store.settings.factor}`));
        }
        if (body.thresholds && typeof body.thresholds === "object") {
          const input = body.thresholds as Partial<Record<keyof Thresholds, unknown>>;
          const next = { ...store.settings.thresholds };
          const changed: string[] = [];
          for (const key of Object.keys(DEFAULT_THRESHOLDS) as Array<keyof Thresholds>) {
            if (!(key in input)) continue;
            const value = input[key] === null ? DEFAULT_THRESHOLDS[key] : Number(input[key]);
            if (!Number.isFinite(value) || value < 0) throw new Error(`Seuil invalide : ${key}`);
            if (value !== next[key]) changed.push(`${key} ${next[key]} → ${value}`);
            next[key] = value;
          }
          store.settings.thresholds = next;
          if (changed.length) store.journal.push(journalLine(who, `Réglages : ${changed.join(", ")}`));
        }
        return { ok: true };
      }
      if (body.action === "check") {
        const id = clean(body.id, 300);
        const weekStart = clean(body.weekStart, 10);
        const label = clean(body.label, 400);
        if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new Error("Case invalide");
        const key = `${weekStart}|${id}`;
        if (body.checked) {
          store.checks[key] = { at: new Date().toISOString(), who: person, label };
          store.journal.push(journalLine(person, `✓ ${label}`));
        } else {
          delete store.checks[key];
          store.journal.push(journalLine(person, `Décoché : ${label}`));
        }
        return { ok: true };
      }
      if (body.action === "log") {
        store.journal.push(journalLine(who, clean(body.what, 400)));
        return { ok: true };
      }
      throw new Error("Action inconnue");
    });
    invalidatePipeline();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action impossible" }, { status: 400 });
  }
}
