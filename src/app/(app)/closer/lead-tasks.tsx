"use client";

import { useEffect, useState } from "react";
import { BookOpenText, CalendarPlus, Check, CircleCheck, Copy, FileText, MessageCircle, Phone, Share2, Target, X } from "lucide-react";
import { toast } from "sonner";
import type { LeadView } from "@/app/api/closer/route";
import { REASON_LABEL, creditOf, followUpText, type LeadReason } from "@/lib/closer/leads";
import { OBJECTIONS } from "@/lib/closer/resources";
import { CALL_GOAL, CLOSING_SCRIPT, CONTRACT_FILE, SETTING_SCRIPT, fillScript, type CallScript } from "@/lib/closer/scripts";
import { cn } from "@/lib/utils";

/**
 * Les onglets Leads, Contrat et Ressources du closer : la liste des leads à
 * appeler (case « appelé »), la fiche d'un lead (appel, message de relance,
 * 2e rendez-vous), les scripts, le contrat et les objections.
 */

const card = "rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]";
const field = "h-11 w-full rounded-xl bg-slate-50 px-3 text-[15px] outline-none ring-1 ring-slate-900/10 focus:bg-white dark:bg-slate-800 dark:ring-white/10";

type Act = (body: Record<string, unknown>, done?: string) => Promise<boolean>;

function fmt(iso: string | number, tz: string, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, ...options }).format(new Date(iso));
  } catch {
    return "—";
  }
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
const state = (place: string) => place.split(",").pop()?.trim() || place;
const digits = (phone: string) => phone.replace(/\D/g, "");

/** Le numéro lisible : +1 305 555 0102. */
function prettyPhone(phone: string) {
  const d = digits(phone);
  if (d.length === 11 && d.startsWith("1")) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : phone;
}

function copy(text: string, what: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${what} copié`))
    .catch(() => toast.error("Copie impossible : sélectionne le texte à la main"));
}

const REASON_TONE: Record<LeadReason, string> = {
  qualified: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  review: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  "credit-550": "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};

/** Coché = appelé (ou rendez-vous posé). La case reste cochée, le lead garde sa place. */
export function isCalled(lead: LeadView) {
  return (lead.callStatus ?? "todo") !== "todo";
}

function toggleCalled(lead: LeadView, onAct: Act) {
  const checked = isCalled(lead);
  void onAct({ action: "update-lead", id: lead.id, callStatus: checked ? "todo" : "called" });
}

function CheckBox({ lead, onAct, big }: { lead: LeadView; onAct: Act; big?: boolean }) {
  const checked = isCalled(lead);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? `${lead.name} appelé` : `Cocher ${lead.name} comme appelé`}
      onClick={() => toggleCalled(lead, onAct)}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg border-2 border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900",
        big ? "h-9 w-9" : "h-8 w-8"
      )}
    >
      {checked && <Check className={cn("text-green-600", big ? "h-6 w-6" : "h-5 w-5")} strokeWidth={3.5} />}
    </button>
  );
}

/* ---------- Tâches du jour (onglet Agenda) ---------- */

export function TasksCard({ toCall, toConfirm, todayCalls, onLeads, onConfirm }: { toCall: number; toConfirm: number; todayCalls: number; onLeads: () => void; onConfirm: () => void }) {
  const tasks = [
    { text: "Leads à appeler", count: toCall, onClick: onLeads },
    { text: "Rendez-vous à confirmer", count: toConfirm, onClick: onConfirm },
    { text: "Calls aujourd'hui", count: todayCalls },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {tasks.map((task) => (
        <button
          key={task.text}
          type="button"
          onClick={task.onClick}
          disabled={!task.onClick}
          className={cn(card, "p-3 text-left disabled:cursor-default", task.count > 0 && task.onClick && "ring-amber-300 dark:ring-amber-500/40")}
        >
          <p className={cn("text-[24px] font-bold leading-none", task.count === 0 ? "text-green-600" : "text-slate-900 dark:text-white")}>{task.count === 0 ? "✓" : task.count}</p>
          <p className="mt-1 text-[12px] font-medium leading-tight text-slate-500">{task.text}</p>
        </button>
      ))}
    </div>
  );
}

/* ---------- Onglet Leads ---------- */

export function LeadsCard({ leads, now, onOpen, onAct, showOwner }: { leads: LeadView[]; now: number; onOpen: (id: string) => void; onAct: Act; showOwner?: (lead: LeadView) => string }) {
  // Ordre fixe (le plus récent en haut) : cocher ne déplace rien.
  const list = leads.filter((lead) => lead.reason).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const left = list.filter((lead) => !isCalled(lead)).length;

  return (
    <div className={card}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[16px] font-bold">
          <Phone className="h-4 w-4" /> Leads à appeler
        </h2>
        <span className="text-[13px] font-semibold text-slate-500">{left} à appeler</span>
      </div>
      <p className="mb-3 text-[13px] text-slate-500">WhatsApp d&apos;abord, sinon son numéro. Pas de réponse : le message (dans sa fiche). Puis coche ✓.</p>
      {list.length === 0 ? (
        <p className="py-6 text-center text-[14px] text-slate-500">Aucun lead pour l&apos;instant. Les nouveaux arrivent ici tout seuls.</p>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-900/[0.06] dark:divide-white/5 dark:ring-white/[0.06]">
          {list.map((lead) => {
            const hour = hourIn(now, lead.tz);
            const late = hour < 9 || hour >= 21;
            return (
              <div key={lead.id} className="flex items-center gap-2 px-3 py-2.5">
                <button type="button" onClick={() => onOpen(lead.id)} className="min-w-0 flex-1 text-left">
                  <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                    <span className="truncate">{lead.name || lead.email || lead.phone}</span>
                    {lead.reason && lead.reason !== "qualified" && (
                      <span className={cn("shrink-0 rounded px-1.5 py-px text-[10px] font-bold", REASON_TONE[lead.reason])}>{REASON_LABEL[lead.reason]}</span>
                    )}
                  </p>
                  <p className="truncate text-[12px] text-slate-500">
                    {creditOf(lead) || "—"} · {state(lead.place) || "—"} · {fmt(now, lead.tz, { hour: "2-digit", minute: "2-digit" })} chez lui{late ? " 🌙" : ""}
                    {showOwner ? ` · ${showOwner(lead)}` : ""}
                  </p>
                </button>
                {lead.phone && (
                  <a
                    href={`https://wa.me/${digits(lead.phone)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#25D366] text-white"
                    aria-label={`WhatsApp ${lead.name}`}
                  >
                    <MessageCircle className="h-5 w-5" />
                  </a>
                )}
                <CheckBox lead={lead} onAct={onAct} />
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[12px] text-slate-500">🌙 trop tôt ou trop tard chez lui (avant 9 h, après 21 h).</p>
    </div>
  );
}

/* ---------- Fiche du lead ---------- */

export function LeadSheet({ lead, now, tz, onClose, onAct }: { lead: LeadView; now: number; tz: string; onClose: () => void; onAct: Act }) {
  const [note, setNote] = useState(lead.callNote ?? "");
  const [start, setStart] = useState("");
  const phone = digits(lead.phone);
  const message = followUpText(lead.name);
  const startMs = start ? zonedToUtc(start, tz) : NaN;
  const step = "mb-2 text-[14px] font-bold";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto overscroll-contain bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] shadow-xl dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-[22px] font-bold">{lead.name || lead.email || lead.phone}</h2>
            <p className="text-[13px] text-slate-500">
              {creditOf(lead) || "—"} · {lead.place || "—"} · {fmt(now, lead.tz, { hour: "2-digit", minute: "2-digit" })} chez lui
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
            <X className="h-6 w-6" />
          </button>
        </div>

        {phone ? (
          <>
            <p className={step}>1. Appelle-le</p>
            <div className="mb-5 grid grid-cols-2 gap-2">
              <a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] py-3 text-[14px] font-bold text-white">
                <MessageCircle className="h-5 w-5" /> WhatsApp
              </a>
              <a href={`tel:+${phone}`} className="flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 py-3 text-[14px] font-bold text-white">
                <Phone className="h-5 w-5" /> Appel normal
              </a>
            </div>

            <p className={step}>2. Pas de réponse : envoie le message</p>
            <p className="mb-2 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-[13px] leading-relaxed dark:bg-slate-800/60">{message}</p>
            <div className="mb-5 grid grid-cols-2 gap-2">
              <a
                href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] py-3 text-[14px] font-bold text-white"
              >
                <MessageCircle className="h-5 w-5" /> Envoyer sur WhatsApp
              </a>
              <button type="button" onClick={() => copy(prettyPhone(lead.phone), "Numéro")} className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-3 text-[13px] font-bold dark:bg-slate-800">
                <Copy className="h-4 w-4" /> {prettyPhone(lead.phone)}
              </button>
              <button type="button" onClick={() => copy(message, "Message")} className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-3 text-[13px] font-bold text-white dark:bg-white dark:text-slate-900">
                <Copy className="h-4 w-4" /> Copier le message
              </button>
            </div>
          </>
        ) : (
          <p className="mb-5 text-[14px] text-rose-600">Pas de numéro pour ce lead.</p>
        )}

        <div className="mb-5 flex items-center gap-3">
          <CheckBox lead={lead} onAct={onAct} big />
          <p className="text-[14px] font-bold">{isCalled(lead) ? "Appelé" : "3. Coche quand il est appelé"}</p>
        </div>

        <p className={cn(step, "flex items-center gap-1.5")}>
          <CalendarPlus className="h-4 w-4" /> Il est d&apos;accord : pose le rendez-vous
        </p>
        {lead.callAt ? (
          <p className="mb-5 rounded-xl bg-green-50 p-3 text-[14px] font-semibold text-green-800 dark:bg-green-500/10 dark:text-green-300">
            RDV le {fmt(lead.callAt, tz, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
          </p>
        ) : (
          <div className="mb-5">
            <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className={field} />
            <p className="mt-1 text-[12px] text-slate-500">
              {Number.isFinite(startMs)
                ? `Ton heure (${city(tz)}). Chez lui : ${fmt(startMs, lead.tz, { weekday: "long", hour: "2-digit", minute: "2-digit" })}`
                : `À ton heure (${city(tz)}). Le call arrive dans ton agenda avec ton lien Meet.`}
            </p>
            <button
              type="button"
              disabled={!Number.isFinite(startMs)}
              onClick={() =>
                void onAct({ action: "book-lead", id: lead.id, startAt: new Date(startMs).toISOString(), durationMin: 15 }, "Rendez-vous posé").then((ok) => {
                  if (ok) onClose();
                })
              }
              className="mt-2 w-full rounded-xl bg-sky-600 py-3 text-[14px] font-bold text-white disabled:opacity-40"
            >
              Poser le rendez-vous
            </button>
          </div>
        )}

        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          placeholder="Note (rappel, objection…)"
          className="mb-2 w-full rounded-xl bg-slate-50 p-3 text-[16px] outline-none ring-1 ring-slate-900/10 focus:bg-white dark:bg-slate-800 dark:ring-white/10"
        />
        {note !== (lead.callNote ?? "") && (
          <button
            type="button"
            onClick={() => void onAct({ action: "update-lead", id: lead.id, callNote: note }, "Note enregistrée")}
            className="mb-5 rounded-xl bg-slate-900 px-4 py-2 text-[13px] font-bold text-white dark:bg-white dark:text-slate-900"
          >
            Enregistrer la note
          </button>
        )}

        {lead.answers.length > 0 && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <p className="mb-1.5 text-[13px] font-bold">Ses réponses</p>
            <ul className="space-y-1 text-[13px]">
              {lead.answers.map((item) => (
                <li key={item.label} className="flex justify-between gap-3">
                  <span className="text-slate-500">{item.label}</span>
                  <b className="text-right">{item.value}</b>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Scripts ---------- */

export function ScriptView({ script, name, open }: { script: CallScript; name?: string; open?: boolean }) {
  return (
    <details className={cn(card, "group")} open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[15px] font-bold">
        <span className="flex items-center gap-2">
          <BookOpenText className="h-4 w-4" /> {script.title}
        </span>
        <span className="text-[13px] font-semibold text-sky-600 group-open:hidden">Ouvrir</span>
        <span className="hidden text-[13px] font-semibold text-slate-500 group-open:inline">Fermer</span>
      </summary>
      <div className="mt-3 space-y-4">
        {script.sections.map((section) => {
          let n = 0;
          return (
            <div key={section.title}>
              <p className="mb-1 text-[13px] font-bold text-green-700 dark:text-green-400">{section.title}</p>
              <div className="space-y-1.5 text-[14px] leading-relaxed">
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

export function ScriptsSection() {
  return (
    <div className="space-y-3">
      <ScriptView script={SETTING_SCRIPT} />
      <ScriptView script={CLOSING_SCRIPT} />
    </div>
  );
}

/* ---------- Le but de l'appel ---------- */

export function GoalCard() {
  return (
    <div className={card}>
      <p className="mb-2 flex items-center gap-2 text-[15px] font-bold">
        <Target className="h-4 w-4" /> {CALL_GOAL.title}
      </p>
      <ul className="space-y-1.5 text-[14px]">
        {CALL_GOAL.points.map((point) => (
          <li key={point} className="flex gap-2">
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Onglet Ressources : objections ---------- */

export function ObjectionsCard() {
  return (
    <div className={card}>
      <h2 className="mb-3 text-[16px] font-bold">Objections courantes</h2>
      <div className="space-y-2">
        {OBJECTIONS.map((item) => (
          <details key={item.title} className="group rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[14px] font-semibold">
              {item.title}
              <span className="text-[18px] leading-none text-slate-400 group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 text-[13px] italic text-slate-500">“{item.q}”</p>
            <p className="mt-1.5 text-[14px] leading-relaxed">“{item.a}”</p>
            <button type="button" onClick={() => copy(item.a, "Réponse")} className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-sky-600">
              <Copy className="h-3.5 w-3.5" /> Copier
            </button>
          </details>
        ))}
      </div>
    </div>
  );
}

/* ---------- Onglet Contrat ---------- */

/**
 * Le PDF est chargé à l'avance : sur iPhone, le partage (WhatsApp, Mail…) doit
 * partir directement du toucher, sans attendre un téléchargement.
 */
export function ContractCard() {
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
    <div className={card}>
      <h2 className="mb-1 flex items-center gap-2 text-[16px] font-bold">
        <FileText className="h-5 w-5" /> Contrat IBOState
      </h2>
      <p className="mb-4 text-[14px] text-slate-500">À envoyer au lead qui dit oui, juste après le call.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={share} disabled={!file} className="flex items-center justify-center gap-2 rounded-xl bg-green-600 py-3.5 text-[15px] font-bold text-white disabled:opacity-40">
          <Share2 className="h-5 w-5" /> Envoyer le contrat
        </button>
        <a href="/api/closer/contrat" target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-3.5 text-[15px] font-bold dark:bg-slate-800">
          <FileText className="h-5 w-5" /> Voir le PDF
        </a>
      </div>
    </div>
  );
}
