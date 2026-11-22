"use client";

import { useEffect, useState } from "react";
import { BookOpenText, CalendarPlus, Check, CircleAlert, CircleCheck, CircleHelp, CircleX, FileText, ListChecks, MessageCircle, MessageSquare, Phone, Share2, Target, X } from "lucide-react";
import { toast } from "sonner";
import type { LeadView } from "@/app/api/closer/route";
import { evaluateCriteria, type CriterionState } from "@/lib/closer/criteria";
import { LEAD_STATUS_LABEL, MAX_ATTEMPTS, REASON_LABEL, bookingLink, creditOf, followUpText, type LeadCallStatus, type LeadReason } from "@/lib/closer/leads";
import { CALL_GOAL, CLOSING_SCRIPT, CONTRACT_FILE, SETTING_SCRIPT, fillScript, type CallScript } from "@/lib/closer/scripts";
import { cn } from "@/lib/utils";

/**
 * Les tâches du jour du closer : appeler les leads (qualifiés, à vérifier, et
 * non qualifiés à 550–599 seulement), expliquer le programme, filtrer, poser
 * le 2e rendez-vous. Avec les scripts (setting et closing) et le contrat.
 */

const card = "rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]";
const field = "h-10 w-full rounded-lg bg-slate-50 px-3 text-[13px] outline-none ring-1 ring-slate-900/10 focus:bg-white dark:bg-slate-800 dark:ring-white/10";
const label = "text-[11px] font-semibold uppercase tracking-wide text-slate-500";

type Act = (body: Record<string, unknown>, done?: string) => Promise<boolean>;

function fmt(iso: string | number, tz: string, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, ...options }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function dayKey(iso: string | number, tz: string) {
  return fmt(iso, tz, { year: "numeric", month: "2-digit", day: "2-digit" });
}

function hourIn(now: number, tz: string) {
  return Number(fmt(now, tz, { hour: "2-digit", hourCycle: "h23" }).replace(/\D/g, "")) || 0;
}

/** « 2026-11-24T18:00 » lu à l'heure du fuseau donné (celui du closer), en millisecondes UTC. */
function zonedToUtc(local: string, tz: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return NaN;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = (at: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - at;
  };
  try {
    const first = wall - offset(wall);
    return wall - offset(first);
  } catch {
    return new Date(local).getTime();
  }
}

const city = (tz: string) => tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
const digits = (phone: string) => phone.replace(/\D/g, "");

const REASON_TONE: Record<LeadReason, string> = {
  qualified: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  review: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  "credit-550": "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};

/** « new » = jamais appelé ; « retry » = sans réponse, à relancer aujourd'hui ; null = rien à faire. */
export function leadTask(lead: LeadView, now: number, tz: string): "new" | "retry" | null {
  if (!lead.reason || lead.callAt) return null;
  const status = lead.callStatus ?? "todo";
  if (status === "todo") return "new";
  if (status !== "no-answer" || (lead.callAttempts ?? 0) >= MAX_ATTEMPTS) return null;
  return lead.lastCallAt && dayKey(lead.lastCallAt, tz) === dayKey(now, tz) ? null : "retry";
}

/* ---------- Le but de l'appel ---------- */

export function GoalCard({ compact }: { compact?: boolean }) {
  return (
    <div className={cn(compact ? "mb-4 rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10" : cn(card, "bg-emerald-50/70 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30"))}>
      <p className={cn("flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300", compact ? "mb-1 text-[13px]" : "mb-2 text-[15px]")}>
        <Target className="h-4 w-4" /> {CALL_GOAL.title}
      </p>
      <ul className={cn("space-y-1", compact ? "text-[12px]" : "text-[13px]")}>
        {CALL_GOAL.points.map((point) => (
          <li key={point} className="flex gap-2">
            <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Tâches du jour ---------- */

export function TasksCard({
  leads,
  toConfirm,
  todayCalls,
  now,
  tz,
  onConfirm,
}: {
  leads: LeadView[];
  toConfirm: number;
  todayCalls: number;
  now: number;
  tz: string;
  onConfirm: () => void;
}) {
  const fresh = leads.filter((lead) => leadTask(lead, now, tz) === "new").length;
  const retry = leads.filter((lead) => leadTask(lead, now, tz) === "retry").length;
  const doneToday = leads.filter((lead) => lead.lastCallAt && dayKey(lead.lastCallAt, tz) === dayKey(now, tz)).length;
  const booked = leads.filter((lead) => lead.callStatus === "booked" && lead.lastCallAt && dayKey(lead.lastCallAt, tz) === dayKey(now, tz)).length;
  const tasks: Array<{ text: string; count: number; action?: () => void; href?: string }> = [
    { text: "Appeler les nouveaux leads", count: fresh, href: "#leads" },
    { text: `Relancer les leads sans réponse (${MAX_ATTEMPTS} essais max, 1 par jour)`, count: retry, href: "#leads" },
    { text: "Confirmer les rendez-vous (WhatsApp ou SMS)", count: toConfirm, action: onConfirm },
    { text: "Faire les calls de closing du jour", count: todayCalls, href: "#planning" },
  ];
  return (
    <div className={card}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <ListChecks className="h-4 w-4" /> Tâches du jour
        </h2>
        <p className="text-[12px] text-slate-500">
          Aujourd&apos;hui : <b>{doneToday}</b> appel{doneToday > 1 ? "s" : ""} noté{doneToday > 1 ? "s" : ""} · <b>{booked}</b> RDV posé{booked > 1 ? "s" : ""}
        </p>
      </div>
      <ul className="space-y-1.5">
        {tasks.map((task, index) => {
          const done = task.count === 0;
          const body = (
            <>
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", done ? "bg-emerald-500 text-white" : "bg-slate-900 text-white dark:bg-white dark:text-slate-900")}>
                {done ? "✓" : index + 1}
              </span>
              <span className={cn("flex-1 text-[13px]", done && "text-slate-400 line-through")}>{task.text}</span>
              {!done && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[12px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{task.count}</span>}
            </>
          );
          return (
            <li key={task.text}>
              {task.action ? (
                <button type="button" onClick={task.action} disabled={done} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left">
                  {body}
                </button>
              ) : (
                <a href={task.href} className="flex items-center gap-2.5 rounded-lg px-1 py-1">
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- La liste des leads ---------- */

/** Coché aujourd'hui : le lead a été appelé (ou son résultat noté) aujourd'hui. */
function calledToday(lead: LeadView, now: number, tz: string) {
  return Boolean(lead.lastCallAt && dayKey(lead.lastCallAt, tz) === dayKey(now, tz));
}

/** La case « appelé » : cochée = appelé aujourd'hui ; décocher remet le lead « à appeler ». */
function toggleCalled(lead: LeadView, now: number, tz: string, onAct: Act) {
  const checked = calledToday(lead, now, tz);
  void onAct({ action: "update-lead", id: lead.id, callStatus: checked ? "todo" : "called" }, checked ? `${lead.name} : à appeler` : `${lead.name} : appelé ✓`);
}

const rank = (lead: LeadView, now: number, tz: string) => (calledToday(lead, now, tz) ? 2 : leadTask(lead, now, tz) === "new" ? 0 : 1);

export function LeadsCard({ leads, now, tz, onOpen, onAct, showOwner }: { leads: LeadView[]; now: number; tz: string; onOpen: (id: string) => void; onAct: Act; showOwner?: (lead: LeadView) => string }) {
  const [tab, setTab] = useState<"todo" | "done">("todo");
  const callable = leads.filter((lead) => lead.reason);
  // À appeler : les nouveaux, les relances du jour, puis ceux cochés aujourd'hui (en bas, grisés).
  const inTodo = (lead: LeadView) => Boolean(leadTask(lead, now, tz)) || calledToday(lead, now, tz);
  const todo = callable.filter(inTodo).sort((a, b) => rank(a, now, tz) - rank(b, now, tz) || b.receivedAt.localeCompare(a.receivedAt));
  const done = callable.filter((lead) => !inTodo(lead)).sort((a, b) => (b.lastCallAt ?? b.receivedAt).localeCompare(a.lastCallAt ?? a.receivedAt));
  const left = todo.filter((lead) => !calledToday(lead, now, tz)).length;
  const shown = tab === "todo" ? todo : done;

  return (
    <div id="leads" className={cn(card, "scroll-mt-20")}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <Phone className="h-4 w-4" /> Leads à appeler
        </h2>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-[12px] font-semibold dark:bg-slate-800">
          <button type="button" onClick={() => setTab("todo")} className={cn("rounded-md px-2.5 py-1", tab === "todo" && "bg-white shadow-sm dark:bg-slate-700")}>
            À appeler ({left})
          </button>
          <button type="button" onClick={() => setTab("done")} className={cn("rounded-md px-2.5 py-1", tab === "done" && "bg-white shadow-sm dark:bg-slate-700")}>
            Traités ({done.length})
          </button>
        </div>
      </div>
      <CallRule />
      {shown.length === 0 ? (
        <p className="py-5 text-center text-[13px] text-slate-500">{tab === "todo" ? "Aucun lead à appeler pour l'instant. Les nouveaux arrivent ici tout seuls." : "Aucun lead traité."}</p>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-900/[0.06] dark:divide-white/5 dark:ring-white/[0.06]">
          {shown.map((lead) => {
            const task = leadTask(lead, now, tz);
            const hour = hourIn(now, lead.tz);
            const late = hour < 9 || hour >= 21;
            const checked = calledToday(lead, now, tz);
            return (
              <div key={lead.id} className={cn("flex items-center gap-2 px-3 py-2.5", checked && "bg-slate-50 dark:bg-slate-800/40")}>
                <button type="button" onClick={() => onOpen(lead.id)} className="min-w-0 flex-1 text-left">
                  <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-semibold">
                    <span className={cn("truncate", checked && "text-slate-400 line-through")}>{lead.name || lead.email || lead.phone}</span>
                    {lead.reason && <span className={cn("shrink-0 rounded px-1.5 py-px text-[10px] font-bold", REASON_TONE[lead.reason])}>{REASON_LABEL[lead.reason]}</span>}
                    {task === "retry" && <span className="shrink-0 rounded bg-slate-200 px-1.5 py-px text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">Relance · essai {(lead.callAttempts ?? 0) + 1}</span>}
                    {!task && !checked && (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {lead.callAt ? `RDV ${fmt(lead.callAt, tz, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : LEAD_STATUS_LABEL[lead.callStatus ?? "todo"]}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    Crédit {creditOf(lead) || "—"} · {lead.place || "—"} · chez lui {fmt(now, lead.tz, { hour: "2-digit", minute: "2-digit" })}
                    {late ? " 🌙" : ""} · reçu {fmt(lead.receivedAt, tz, { day: "numeric", month: "short" })}
                    {showOwner ? ` · ${showOwner(lead)}` : ""}
                  </p>
                </button>
                {lead.phone && !checked && (
                  <a
                    href={`https://wa.me/${digits(lead.phone)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#25D366] px-2.5 py-1.5 text-[12px] font-semibold text-white"
                    aria-label={`WhatsApp ${lead.name}`}
                  >
                    <MessageCircle className="h-4 w-4" /> <span className="hidden sm:inline">WhatsApp</span>
                  </a>
                )}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={checked ? `${lead.name} appelé : décocher` : `Cocher : ${lead.name} appelé`}
                  onClick={() => toggleCalled(lead, now, tz, onAct)}
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 transition-colors",
                    checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900"
                  )}
                >
                  {checked && <Check className="h-5 w-5" strokeWidth={3} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-500">Leads appelés : qualifiés, à vérifier, et non qualifiés seulement à 550–599 de crédit. 🌙 = avant 9 h ou après 21 h chez le lead : mieux vaut attendre.</p>
    </div>
  );
}

/* ---------- La règle d'appel ---------- */

export function CallRule() {
  return (
    <div className="mb-3 rounded-xl bg-sky-50 p-3 text-[13px] dark:bg-sky-500/10">
      <p className="mb-1 font-bold text-sky-900 dark:text-sky-200">Comment appeler un lead</p>
      <ol className="space-y-1">
        <li>
          <b>1.</b> Il a WhatsApp : appelle-le <b>sur WhatsApp</b>. Pas de réponse → envoie <b>le message sur WhatsApp</b>.
        </li>
        <li>
          <b>2.</b> Pas de WhatsApp : appelle <b>son numéro normal</b>. Pas de réponse → envoie <b>le message par SMS</b>.
        </li>
        <li>
          <b>3.</b> Coche la case ✓ à droite une fois appelé.
        </li>
      </ol>
      <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">Le message est déjà écrit à son prénom : ouvre sa fiche (touche son nom).</p>
    </div>
  );
}

/* ---------- La fiche du lead ---------- */

const CRIT_ICON: Record<CriterionState, { icon: typeof CircleCheck; tone: string }> = {
  ok: { icon: CircleCheck, tone: "text-emerald-600" },
  ko: { icon: CircleX, tone: "text-rose-600" },
  check: { icon: CircleAlert, tone: "text-amber-600" },
  ask: { icon: CircleHelp, tone: "text-slate-400" },
};

function bookingText(lead: LeadView, host: string) {
  const first = lead.name.trim().split(/\s+/)[0] || "there";
  return `Hi ${first}, this is ${host} from IBOState. Thanks for your application! You can pick a time for a quick 10-minute call with me here: ${bookingLink(lead)}\n\nAnd if you have any questions about the program, I'm here, just reply to this message.`;
}

export function LeadSheet({ lead, now, tz, host, onClose, onAct }: { lead: LeadView; now: number; tz: string; host: string; onClose: () => void; onAct: Act }) {
  const [note, setNote] = useState(lead.callNote ?? "");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState("15");
  const phone = digits(lead.phone);
  const results = evaluateCriteria(lead.answers);
  const startMs = start ? zonedToUtc(start, tz) : NaN;
  const status = lead.callStatus ?? "todo";
  const text = encodeURIComponent(bookingText(lead, host));
  const followUp = followUpText(lead.name);
  const rows: Array<[string, string]> = [
    ["Reçu le", fmt(lead.receivedAt, tz, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })],
    ["Heure chez lui", `${fmt(now, lead.tz, { hour: "2-digit", minute: "2-digit" })} (${city(lead.tz)})`],
    ...(lead.place ? [["Lieu", lead.place] as [string, string]] : []),
    ...(lead.email ? [["E-mail", lead.email] as [string, string]] : []),
    ...(lead.preferredContact ? [["Contact préféré", lead.preferredContact] as [string, string]] : []),
    ...(lead.telegram ? [["Telegram", `@${lead.telegram.replace(/^@/, "")}`] as [string, string]] : []),
    ["Essais d'appel", `${lead.callAttempts ?? 0}${lead.lastCallAt ? ` · dernier ${fmt(lead.lastCallAt, tz, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}`],
  ];
  const setStatus = (callStatus: LeadCallStatus) => void onAct({ action: "update-lead", id: lead.id, callStatus, ...(note !== (lead.callNote ?? "") ? { callNote: note } : {}) }, `${lead.name} : ${LEAD_STATUS_LABEL[callStatus]}`);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto overscroll-contain bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] shadow-xl dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className={label}>Lead à appeler</p>
            <h2 className="text-[20px] font-bold">{lead.name || lead.email || lead.phone}</h2>
            <p className="mt-1 flex flex-wrap gap-1.5">
              {lead.reason && <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold", REASON_TONE[lead.reason])}>{REASON_LABEL[lead.reason]}</span>}
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {lead.callAt ? `RDV le ${fmt(lead.callAt, tz, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : LEAD_STATUS_LABEL[status]}
              </span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        {phone ? (
          <div className="mb-4 space-y-3 rounded-xl bg-sky-50 p-3 dark:bg-sky-500/10">
            <div>
              <p className="mb-1.5 text-[13px] font-bold text-sky-900 dark:text-sky-200">1. Appelle-le</p>
              <div className="flex flex-wrap gap-2">
                <a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-2.5 text-[13px] font-bold text-white">
                  <MessageCircle className="h-4 w-4" /> Sur WhatsApp
                </a>
                <a href={`tel:+${phone}`} className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2.5 text-[13px] font-bold text-white">
                  <Phone className="h-4 w-4" /> Pas de WhatsApp : {lead.phone}
                </a>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">WhatsApp s&apos;ouvre sur sa conversation : touche l&apos;icône 📞 pour l&apos;appeler.</p>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-bold text-sky-900 dark:text-sky-200">2. Pas de réponse : envoie ce message</p>
              <p className="mb-2 whitespace-pre-line rounded-lg bg-white p-2.5 text-[12px] leading-relaxed ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10">{followUp}</p>
              <div className="flex flex-wrap gap-2">
                <a href={`https://wa.me/${phone}?text=${encodeURIComponent(followUp)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-2 text-[13px] font-bold text-white">
                  <MessageCircle className="h-4 w-4" /> Par WhatsApp
                </a>
                <a href={`sms:+${phone}?&body=${encodeURIComponent(followUp)}`} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-[13px] font-bold text-white dark:bg-white dark:text-slate-900">
                  <MessageSquare className="h-4 w-4" /> Par SMS
                </a>
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-bold text-sky-900 dark:text-sky-200">3. Coche-le</p>
              <button
                type="button"
                onClick={() => toggleCalled(lead, now, tz, onAct)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-bold ring-1",
                  calledToday(lead, now, tz) ? "bg-emerald-500 text-white ring-emerald-500" : "bg-white ring-slate-900/15 dark:bg-slate-900 dark:ring-white/15"
                )}
              >
                <span className={cn("flex h-5 w-5 items-center justify-center rounded border-2", calledToday(lead, now, tz) ? "border-white" : "border-slate-400")}>
                  {calledToday(lead, now, tz) && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
                {calledToday(lead, now, tz) ? "Appelé aujourd'hui" : "Appelé"}
              </button>
            </div>
          </div>
        ) : (
          <p className="mb-4 text-[13px] text-rose-600">Pas de numéro pour ce lead.</p>
        )}

        <GoalCard compact />

        <dl className="mb-4 space-y-1.5 text-[13px]">
          {rows.map(([key, value]) => (
            <div key={key} className="flex gap-3">
              <dt className="w-32 shrink-0 text-slate-500">{key}</dt>
              <dd className="min-w-0 break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mb-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <p className={cn(label, "mb-1.5")}>Ses réponses au formulaire</p>
          {lead.reason === "credit-550" && (
            <p className="mb-2 rounded-lg bg-violet-100 px-2 py-1 text-[12px] font-semibold text-violet-800 dark:bg-violet-500/15 dark:text-violet-300">
              Crédit 550–599 : non qualifié sur le site, mais on l&apos;appelle quand même.
            </p>
          )}
          <ul className="space-y-1 text-[13px]">
            {lead.answers.map((item) => (
              <li key={item.label} className="flex justify-between gap-3">
                <span className="text-slate-500">{item.label}</span>
                <b className="text-right">{item.value}</b>
              </li>
            ))}
          </ul>
          <p className={cn(label, "mb-1 mt-3")}>À vérifier au téléphone</p>
          <ul className="space-y-1 text-[12px]">
            {results.map(({ criterion, state }) => {
              const look = CRIT_ICON[state];
              const Icon = look.icon;
              return (
                <li key={criterion.key} className="flex items-center gap-1.5">
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", look.tone)} /> {criterion.title}
                </li>
              );
            })}
          </ul>
        </div>

        <p className={cn(label, "mb-1.5")}>Résultat de l&apos;appel</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(["no-answer", "not-interested", "not-eligible", "todo"] as LeadCallStatus[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStatus(item)}
              className={cn("rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 ring-slate-900/10 dark:ring-white/10", status === item ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-white dark:bg-slate-900")}
            >
              {LEAD_STATUS_LABEL[item]}
            </button>
          ))}
        </div>

        <div className="mb-4 rounded-xl bg-sky-50 p-3 dark:bg-sky-500/10">
          <p className="mb-1 flex items-center gap-2 text-[13px] font-bold text-sky-900 dark:text-sky-200">
            <CalendarPlus className="h-4 w-4" /> Poser le 2e rendez-vous (call de closing)
          </p>
          <p className="mb-2 text-[12px] text-slate-600 dark:text-slate-400">Choisis l&apos;heure avec lui au téléphone. Tu la saisis à ton heure ({city(tz)}) ; le call arrive dans ton planning avec ton lien Meet.</p>
          <div className="flex gap-2">
            <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className={cn(field, "flex-1")} />
            <select value={duration} onChange={(event) => setDuration(event.target.value)} className={cn(field, "w-24")}>
              {["15", "20", "30"].map((min) => (
                <option key={min} value={min}>
                  {min} min
                </option>
              ))}
            </select>
          </div>
          {Number.isFinite(startMs) && (
            <p className="mt-1 text-[12px] font-semibold">
              = {fmt(startMs, lead.tz, { weekday: "long", hour: "2-digit", minute: "2-digit" })} chez lui ({city(lead.tz)})
            </p>
          )}
          <button
            type="button"
            disabled={!Number.isFinite(startMs)}
            onClick={() =>
              void onAct({ action: "book-lead", id: lead.id, startAt: new Date(startMs).toISOString(), durationMin: Number(duration) }, "Rendez-vous posé : pense à lui envoyer la confirmation").then((ok) => {
                if (ok) onClose();
              })
            }
            className="mt-2 w-full rounded-xl bg-sky-600 py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            Poser le rendez-vous
          </button>
          {phone && (
            <div className="mt-3 border-t border-sky-200/70 pt-2 dark:border-sky-500/20">
              <p className="mb-1.5 text-[12px] text-slate-600 dark:text-slate-400">Pas de réponse ou il préfère choisir seul ? Envoie-lui le lien de réservation (le call arrivera tout seul ici) :</p>
              <div className="flex flex-wrap gap-2">
                <a href={`https://wa.me/${phone}?text=${text}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-2 text-[12px] font-bold text-white">
                  <MessageCircle className="h-4 w-4" /> Lien par WhatsApp
                </a>
                <a href={`sms:+${phone}?&body=${text}`} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-[12px] font-bold text-white dark:bg-white dark:text-slate-900">
                  <MessageSquare className="h-4 w-4" /> Lien par SMS
                </a>
              </div>
            </div>
          )}
        </div>

        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          placeholder="Ta note sur l'appel (réponses, objections, rappel prévu…)"
          className="mb-2 w-full rounded-lg bg-slate-50 p-3 text-[16px] outline-none ring-1 ring-slate-900/10 focus:bg-white sm:text-[13px] dark:bg-slate-800 dark:ring-white/10"
        />
        <button
          type="button"
          disabled={note === (lead.callNote ?? "")}
          onClick={() => void onAct({ action: "update-lead", id: lead.id, callNote: note }, "Note enregistrée")}
          className="mb-4 rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
        >
          Enregistrer la note
        </button>

        <ScriptView script={SETTING_SCRIPT} name={lead.name} open />
      </div>
    </div>
  );
}

/* ---------- Scripts ---------- */

export function ScriptView({ script, name, open }: { script: CallScript; name?: string; open?: boolean }) {
  return (
    <details className="group mb-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[14px] font-bold">
        <span className="flex items-center gap-2">
          <BookOpenText className="h-4 w-4" /> {script.title}
        </span>
        <span className="text-[12px] font-semibold text-slate-500 group-open:hidden">Voir</span>
        <span className="hidden text-[12px] font-semibold text-slate-500 group-open:inline">Masquer</span>
      </summary>
      <p className="mt-1 text-[12px] text-slate-500">{script.goal}</p>
      <div className="mt-3 space-y-3">
        {script.sections.map((section) => {
          let n = 0;
          return (
            <div key={section.title}>
              <p className="mb-1 text-[12px] font-bold text-emerald-700 dark:text-emerald-400">{section.title}</p>
              <div className="space-y-1.5 text-[13px] leading-relaxed">
                {section.lines.map((line, index) =>
                  line.t === "note" ? (
                    <p key={index} className="pl-5 text-[12px] italic text-slate-500">
                      {fillScript(line.text, name)}
                    </p>
                  ) : line.t === "q" ? (
                    <p key={index} className="flex gap-1.5">
                      <b className="w-4 shrink-0 text-right">{++n}.</b>
                      <span>“{fillScript(line.text, name)}”</span>
                    </p>
                  ) : (
                    <p key={index}>“{fillScript(line.text, name)}”</p>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function ScriptsCard() {
  return (
    <div className={card}>
      <h2 className="mb-1 flex items-center gap-2 text-[15px] font-bold">
        <BookOpenText className="h-4 w-4" /> Scripts et contrat
      </h2>
      <p className="mb-3 text-[12px] text-slate-500">Setting = quand tu appelles un lead qui vient de remplir le formulaire. Closing = le call réservé. Le contrat part au lead qui dit oui.</p>
      <ScriptView script={SETTING_SCRIPT} />
      <ScriptView script={CLOSING_SCRIPT} />
      <ContractButtons />
    </div>
  );
}

/* ---------- Contrat ---------- */

/**
 * Le PDF est chargé à l'avance : sur iPhone, le partage (WhatsApp, Mail…) doit
 * partir directement du toucher, sans attendre un téléchargement.
 */
export function ContractButtons() {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/closer/contrat")
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (alive && blob) setFile(new File([blob], CONTRACT_FILE, { type: "application/pdf" }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const share = () => {
    if (!file) return;
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "IBOState Agreement" }).catch(() => undefined);
      return;
    }
    // Ordinateur : on télécharge le PDF, à joindre ensuite au message.
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = CONTRACT_FILE;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast.success("Contrat téléchargé : joins-le à ton message");
  };

  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="mb-1 flex items-center gap-2 text-[14px] font-bold">
        <FileText className="h-4 w-4" /> Contrat à envoyer (IBOState Agreement)
      </p>
      <p className="mb-2 text-[12px] text-slate-500">Quand le lead dit oui : envoie-lui le contrat juste après le call, il le signe sur son téléphone. Confirme son e-mail et son numéro.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={share} disabled={!file} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40">
          <Share2 className="h-4 w-4" /> Envoyer le contrat
        </button>
        <a href="/api/closer/contrat" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-[13px] font-semibold ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10">
          <FileText className="h-4 w-4" /> Voir le PDF
        </a>
      </div>
    </div>
  );
}
