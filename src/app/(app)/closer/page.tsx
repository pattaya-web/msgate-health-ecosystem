"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CalendarClock, Check, CircleAlert, CircleCheck, CircleHelp, CircleX, ClipboardList, Copy, ExternalLink, Loader2, MessageCircle, MessageSquare, Phone, Plus, RefreshCw, Trash2, UserRound, Video, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/auth-context";
import type { CallView, CloserPayload, CloserView } from "@/app/api/closer/route";
import type { Answer, CallStatus } from "@/lib/closer/store";
import { CRITERIA, evaluateCriteria, overallVerdict, type CriterionState } from "@/lib/closer/criteria";
import { cn } from "@/lib/utils";

/**
 * Le poste de closer : son agenda de calls, à SON heure, un bouton pour
 * rejoindre le call, et une petite fiche du prospect. L'admin voit tous les
 * agendas, ajoute les closers (accès par lien, sans mot de passe) et peut
 * poser un call à la main. Les calls d'IBOState arrivent tout seuls.
 */

const card = "rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]";
const field = "h-9 w-full rounded-lg bg-slate-50 px-3 text-[13px] outline-none ring-1 ring-slate-900/10 focus:bg-white dark:bg-slate-800 dark:ring-white/10";
const label = "text-[11px] font-semibold uppercase tracking-wide text-slate-500";

const TIMEZONES = [
  "Asia/Dubai",
  "Europe/Paris",
  "Europe/London",
  "Africa/Casablanca",
  "Africa/Algiers",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Australia/Sydney",
];

const STATUS_LABEL: Record<CallStatus, string> = { booked: "Prévu", done: "Fait", "no-show": "No-show", cancelled: "Annulé" };
const STATUS_TONE: Record<CallStatus, string> = {
  booked: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  "no-show": "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  cancelled: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

function fmt(iso: string | number, tz: string, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, ...options }).format(new Date(iso));
  } catch {
    return "—";
  }
}

/** Le jour (AAAA-MM-JJ) d'un instant, dans un fuseau donné. */
function dayKey(iso: string | number, tz: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

function dayTitle(key: string, now: number, tz: string) {
  const today = dayKey(now, tz);
  const tomorrow = dayKey(now + 86_400_000, tz);
  const yesterday = dayKey(now - 86_400_000, tz);
  const date = fmt(`${key}T12:00:00Z`, "UTC", { weekday: "long", day: "numeric", month: "long" });
  if (key === today) return `Aujourd'hui · ${date}`;
  if (key === tomorrow) return `Demain · ${date}`;
  if (key === yesterday) return `Hier · ${date}`;
  return date.charAt(0).toUpperCase() + date.slice(1);
}

function until(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min <= 0) return "maintenant";
  if (min < 60) return `dans ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `dans ${h} h ${String(min % 60).padStart(2, "0")}`;
  return `dans ${Math.round(h / 24)} j`;
}

function tzLabel(tz: string) {
  return tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
}

function digits(phone: string) {
  return phone.replace(/\D/g, "");
}

/** Le call est « en direct » de 10 min avant son début jusqu'à sa fin. */
function isLive(call: CallView, now: number) {
  const start = Date.parse(call.startAt);
  return now >= start - 10 * 60_000 && now <= start + call.durationMin * 60_000;
}

/** Les réponses du call (avant réservation) puis celles du formulaire, sans doublon. */
function allAnswers(call: CallView): Answer[] {
  return [...call.answers, ...(call.lead?.answers ?? []).filter((item) => !call.answers.some((own) => own.label === item.label))];
}

const CRITERION_ICON: Record<CriterionState, { icon: typeof CircleCheck; tone: string; text: string }> = {
  ok: { icon: CircleCheck, tone: "text-emerald-600", text: "OK" },
  ko: { icon: CircleX, tone: "text-rose-600", text: "Non sélectionné" },
  check: { icon: CircleAlert, tone: "text-amber-600", text: "À vérifier" },
  ask: { icon: CircleHelp, tone: "text-slate-400", text: "À demander" },
};

/** Un call prévu, pas encore passé, dont la confirmation n'a pas été envoyée au prospect. */
function needsConfirm(call: CallView, now: number) {
  return call.status === "booked" && !call.confirmedAt && Date.parse(call.startAt) > now;
}

/** Le message de confirmation, en anglais, à l'heure du prospect, avec le lien du call. */
function confirmText(call: CallView) {
  const first = call.name.trim().split(/\s+/)[0] || "there";
  let when = "";
  try {
    when = new Intl.DateTimeFormat("en-US", { timeZone: call.prospectTz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(call.startAt));
  } catch {
    when = new Date(call.startAt).toUTCString();
  }
  const host = call.host || "Kelly";
  const join = call.joinUrl ? `Join here at that time:\n${call.joinUrl}` : "I'll call you at this number.";
  return `Hi ${first}, this is ${host} from IBOState 👋\nJust confirming our call on ${when}.\n${join}\n\nCan you reply YES to confirm? Talk soon!`;
}

function confirmLinks(call: CallView) {
  const phone = digits(call.phone);
  const text = encodeURIComponent(confirmText(call));
  return phone ? { whatsapp: `https://wa.me/${phone}?text=${text}`, sms: `sms:+${phone}?&body=${text}` } : null;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/closer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as CloserPayload & { error?: string };
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
  return json;
}

export default function CloserPage() {
  const { user } = useAuth();
  const [data, setData] = useState<CloserPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<string>("all");
  const [past, setPast] = useState(false);
  // Pop-up « à confirmer » : s'ouvre tout seul pour le closer tant qu'un call attend sa confirmation ; « Plus tard » le ferme jusqu'au prochain chargement.
  const [confirmDismissed, setConfirmDismissed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/closer")
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as CloserPayload & { error?: string };
        if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
        setData(json);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    // Un call réservé arrive à tout moment : l'agenda se relit toute la minute.
    const poll = setInterval(load, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const isAdmin = data?.role === "admin";
  const selected = isAdmin && view !== "all" && view !== "none" ? data?.closers.find((closer) => closer.id === view) ?? null : null;
  // L'agenda s'affiche à l'heure du closer ; « Tous » à l'heure de ce navigateur.
  const browserTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris", []);
  const tz = data?.me?.timezone ?? selected?.timezone ?? browserTz;

  const all = data?.calls ?? [];
  const calls = !isAdmin || view === "all" ? all : view === "none" ? all.filter((call) => !call.closerId) : all.filter((call) => call.closerId === view);

  const upcoming = calls.filter((call) => Date.parse(call.startAt) + call.durationMin * 60_000 >= now);
  const shown = past ? calls.filter((call) => Date.parse(call.startAt) + call.durationMin * 60_000 < now).reverse() : upcoming;
  const next = upcoming.find((call) => call.status === "booked") ?? null;
  const groups = new Map<string, CallView[]>();
  for (const call of shown) {
    const key = dayKey(call.startAt, tz);
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  const byDay = [...groups.entries()];
  const todayCount = upcoming.filter((call) => dayKey(call.startAt, tz) === dayKey(now, tz) && call.status !== "cancelled").length;
  const unassigned = (data?.calls ?? []).filter((call) => !call.closerId && Date.parse(call.startAt) >= now - 3_600_000).length;
  const open = data?.calls.find((call) => call.id === openId) ?? null;
  const toConfirm = calls.filter((call) => needsConfirm(call, now));

  const act = async (body: Record<string, unknown>, done?: string) => {
    try {
      setData(await post(body));
      if (done) toast.success(done);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };

  if (error && !data) return <div className={cn(card, "text-[13px] text-rose-600")}>{error}</div>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement de l&apos;agenda…
      </div>
    );
  }
  if (!isAdmin && !data.me) return <div className={card}>Ton accès closer n&apos;est plus actif. Demande un nouveau lien à Mady.</div>;

  const name = data.me?.name ?? user?.full_name ?? "";

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{isAdmin ? "Closers · Agenda" : `Bonjour ${name} 👋`}</h1>
          <p className="text-[13px] text-slate-500">
            {isAdmin ? "Les calls réservés sur IBOState arrivent ici tout seuls, dans l'agenda du bon closer." : "Tes calls réservés, à ton heure."} Heure affichée :{" "}
            <b>{fmt(now, tz, { hour: "2-digit", minute: "2-digit" })}</b> ({tzLabel(tz)})
            {todayCount ? ` · ${todayCount} call${todayCount > 1 ? "s" : ""} aujourd'hui` : " · aucun call aujourd'hui"}
          </p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-[12px] font-semibold dark:bg-slate-800">
          <RefreshCw className="h-3.5 w-3.5" /> Actualiser
        </button>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-1.5">
          {[{ id: "all", name: "Tous" }, ...data.closers, ...(unassigned ? [{ id: "none", name: `Sans closer (${unassigned})` }] : [])].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={cn(
                "rounded-full px-3 py-1 text-[12px] font-semibold ring-1",
                view === item.id ? "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900" : "bg-white ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10",
                item.id === "none" && view !== "none" && "text-amber-700"
              )}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}

      {next && (
        <div className={cn(card, "flex flex-wrap items-center justify-between gap-3", isLive(next, now) && "ring-2 ring-emerald-500")}>
          <div className="min-w-0">
            <p className={label}>{isLive(next, now) ? "C'est l'heure" : "Prochain call"}</p>
            <p className="truncate text-[18px] font-bold">{next.name}</p>
            <p className="text-[13px] text-slate-500">
              {fmt(next.startAt, tz, { weekday: "long", hour: "2-digit", minute: "2-digit" })} · {next.durationMin} min · <b>{until(Date.parse(next.startAt) - now)}</b>
              {isAdmin && next.closerName ? ` · ${next.closerName}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <JoinButton call={next} big />
            <button type="button" onClick={() => setOpenId(next.id)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2.5 text-[13px] font-semibold dark:bg-slate-800">
              <UserRound className="h-4 w-4" /> Fiche
            </button>
          </div>
        </div>
      )}

      {toConfirm.length > 0 && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-left ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/30"
        >
          <span className="flex items-center gap-2 text-[14px] font-bold text-amber-800 dark:text-amber-300">
            <BellRing className="h-4 w-4" /> {toConfirm.length} rendez-vous à confirmer
          </span>
          <span className="rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-bold text-white">Confirmer</span>
        </button>
      )}

      <div className={card}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-bold">
            <CalendarClock className="h-4 w-4" /> Planning
          </h2>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-[12px] font-semibold dark:bg-slate-800">
            <button type="button" onClick={() => setPast(false)} className={cn("rounded-md px-2.5 py-1", !past && "bg-white shadow-sm dark:bg-slate-700")}>
              À venir
            </button>
            <button type="button" onClick={() => setPast(true)} className={cn("rounded-md px-2.5 py-1", past && "bg-white shadow-sm dark:bg-slate-700")}>
              Passés
            </button>
          </div>
        </div>
        {byDay.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-slate-500">
            {past ? "Aucun call passé." : "Aucun call prévu pour l'instant. Dès qu'un prospect réserve, il apparaît ici."}
          </p>
        ) : (
          <div className="space-y-4">
            {byDay.map(([key, items]) => (
              <div key={key}>
                <p className="mb-1.5 text-[12px] font-bold text-slate-500">{dayTitle(key, now, tz)}</p>
                <div className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-900/[0.06] dark:divide-white/5 dark:ring-white/[0.06]">
                  {items.map((call) => (
                    <div
                      key={call.id}
                      className={cn("flex items-center gap-2 px-3 py-2.5 sm:gap-3", isLive(call, now) && call.status === "booked" && "bg-emerald-50 dark:bg-emerald-500/10")}
                    >
                      <div className="w-14 shrink-0 sm:w-[92px]">
                        <p className="text-[15px] font-bold tabular-nums">{fmt(call.startAt, tz, { hour: "2-digit", minute: "2-digit" })}</p>
                        <p className="text-[11px] text-slate-500">{call.durationMin} min</p>
                      </div>
                      <button type="button" onClick={() => setOpenId(call.id)} className="min-w-0 flex-1 text-left">
                        <p className="flex items-center gap-1.5 truncate text-[14px] font-semibold">
                          {call.name}
                          {needsConfirm(call, now) && (
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">À confirmer</span>
                          )}
                          {call.confirmedAt && call.status === "booked" && (
                            <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-px text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Confirmé</span>
                          )}
                          {overallVerdict(evaluateCriteria(allAnswers(call))) === "ko" && (
                            <span className="shrink-0 rounded bg-rose-100 px-1.5 py-px text-[10px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">Non éligible</span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          Prospect : {fmt(call.startAt, call.prospectTz, { hour: "2-digit", minute: "2-digit" })} ({tzLabel(call.prospectTz)})
                          {call.lead?.place ? ` · ${call.lead.place}` : ""}
                          {isAdmin ? ` · ${call.closerName || "sans closer"}` : ""}
                        </p>
                      </button>
                      <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold", STATUS_TONE[call.status], call.status === "booked" && !past && "hidden sm:inline")}>{STATUS_LABEL[call.status]}</span>
                      {call.status === "booked" && !past && <JoinButton call={call} compact />}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <CriteriaCard open={!isAdmin} />

      {isAdmin && <AdminPanel data={data} onAct={act} />}

      {(confirmOpen || (!isAdmin && !confirmDismissed)) && toConfirm.length > 0 && (
        <ConfirmModal
          calls={toConfirm}
          tz={tz}
          onAct={act}
          onClose={() => {
            setConfirmOpen(false);
            setConfirmDismissed(true);
          }}
        />
      )}

      {open && <ProspectSheet call={open} now={now} tz={tz} isAdmin={isAdmin} closers={data.closers} onClose={() => setOpenId(null)} onAct={act} />}
    </div>
  );
}

function JoinButton({ call, big, compact }: { call: CallView; big?: boolean; compact?: boolean }) {
  const size = big ? "px-4 py-2.5 text-[13px]" : "px-3 py-1.5 text-[12px]";
  // Dans la liste, sur téléphone : l'icône seule, le nom du prospect garde la place.
  const text = compact ? "hidden sm:inline" : "";
  if (call.joinUrl) {
    return (
      <a href={call.joinUrl} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 font-semibold text-white hover:bg-emerald-700", size)}>
        <Video className="h-4 w-4" /> <span className={text}>Rejoindre</span>
      </a>
    );
  }
  return (
    <a href={`tel:+${digits(call.phone)}`} className={cn("inline-flex items-center gap-1.5 rounded-xl bg-sky-600 font-semibold text-white hover:bg-sky-700", size)}>
      <Phone className="h-4 w-4" /> <span className={text}>Appeler</span>
    </a>
  );
}

function ProspectSheet({
  call,
  now,
  tz,
  isAdmin,
  closers,
  onClose,
  onAct,
}: {
  call: CallView;
  now: number;
  tz: string;
  isAdmin: boolean;
  closers: CloserView[];
  onClose: () => void;
  onAct: (body: Record<string, unknown>, done?: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState(call.closerNote);
  const lead = call.lead;
  const phone = digits(call.phone);
  const rows: Array<[string, string]> = [
    ["Heure du call", `${fmt(call.startAt, tz, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} (${tzLabel(tz)})`],
    ["Heure du prospect", `${fmt(call.startAt, call.prospectTz, { hour: "2-digit", minute: "2-digit" })} (${tzLabel(call.prospectTz)})`],
    ["Durée", `${call.durationMin} min`],
    ...(call.email || lead?.email ? [["E-mail", call.email || lead?.email || ""] as [string, string]] : []),
    ...(lead?.place ? [["Lieu", lead.place] as [string, string]] : []),
    ...(lead?.preferredContact ? [["Contact préféré", lead.preferredContact] as [string, string]] : []),
    ...(lead?.telegram ? [["Telegram", `@${lead.telegram.replace(/^@/, "")}`] as [string, string]] : []),
  ];
  const answers = allAnswers(call);
  const results = evaluateCriteria(answers);
  const verdict = overallVerdict(results);
  const usedLabels = new Set(CRITERIA.flatMap((criterion) => criterion.labels));
  const others = answers.filter((item) => !usedLabels.has(item.label));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className={label}>Fiche prospect</p>
            <h2 className="text-[20px] font-bold">{call.name}</h2>
            {lead && (
              <span
                className={cn(
                  "mt-1 inline-block rounded-md px-2 py-0.5 text-[11px] font-bold",
                  lead.eligibility === "qualified" ? "bg-emerald-100 text-emerald-700" : lead.eligibility === "disqualified" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
                )}
              >
                {lead.eligibility === "qualified" ? "✅ Qualifié" : lead.eligibility === "disqualified" ? "❌ Non qualifié" : "⚠️ À vérifier"}
              </span>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <JoinButton call={call} big />
          {phone && (
            <>
              <a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2.5 text-[13px] font-semibold dark:bg-slate-800">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
              <a href={`tel:+${phone}`} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2.5 text-[13px] font-semibold dark:bg-slate-800">
                <Phone className="h-4 w-4" /> {call.phone}
              </a>
            </>
          )}
        </div>

        <dl className="mb-4 space-y-1.5 text-[13px]">
          {rows.map(([key, value]) => (
            <div key={key} className="flex gap-3">
              <dt className="w-32 shrink-0 text-slate-500">{key}</dt>
              <dd className="min-w-0 break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        {call.status === "booked" && Date.parse(call.startAt) > now - 3_600_000 && (
          <div className={cn("mb-4 rounded-xl p-3", call.confirmedAt ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-amber-50 dark:bg-amber-500/10")}>
            <p className={cn(label, "mb-1")}>Confirmation du rendez-vous</p>
            {call.confirmedAt ? (
              <p className="text-[13px]">
                ✅ Confirmation envoyée le {fmt(call.confirmedAt, tz, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.{" "}
                <button type="button" onClick={() => void onAct({ action: "update-call", id: call.id, confirmed: false })} className="font-semibold text-slate-500 underline">
                  Annuler
                </button>
              </p>
            ) : (
              <>
                <p className="mb-2 text-[13px]">Envoie-lui le message de confirmation (déjà écrit, avec l&apos;heure chez lui et le lien du call).</p>
                <ConfirmButtons call={call} onAct={onAct} />
              </>
            )}
          </div>
        )}

        <div
          className={cn(
            "mb-4 rounded-xl p-3",
            verdict === "ko" ? "bg-rose-50 dark:bg-rose-500/10" : verdict === "check" ? "bg-amber-50 dark:bg-amber-500/10" : "bg-slate-50 dark:bg-slate-800/60"
          )}
        >
          <p className={cn(label, "mb-1")}>Critères IBOState</p>
          <p className="mb-2 text-[13px] font-bold">
            {verdict === "ko"
              ? "❌ Ne remplit pas les critères : ne pas valider le dossier."
              : verdict === "check"
                ? "⚠️ Des points à vérifier pendant le call."
                : "✅ Rien d'éliminatoire dans ses réponses : vérifie ce qui reste « à demander »."}
          </p>
          <ul className="space-y-1.5 text-[13px]">
            {results.map(({ criterion, state, value }) => {
              const look = CRITERION_ICON[state];
              const Icon = look.icon;
              return (
                <li key={criterion.key} className="flex gap-2">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", look.tone)} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{criterion.title}</p>
                    <p className="text-[11px] text-slate-500">
                      <b className={look.tone}>{look.text}</b>
                      {value ? ` · réponse : ${value}` : ""}
                      {state !== "ok" ? ` · ${criterion.rule}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {others.length > 0 && (
          <div className="mb-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <p className={cn(label, "mb-1.5")}>Autres réponses</p>
            <ul className="space-y-1 text-[13px]">
              {others.map((item) => (
                <li key={item.label} className="flex justify-between gap-3">
                  <span className="text-slate-500">{item.label}</span>
                  <b className="text-right">{item.value}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(call.notes || lead?.notes) && (
          <div className="mb-4 rounded-xl bg-amber-50 p-3 text-[13px] dark:bg-amber-500/10">
            <p className={cn(label, "mb-1")}>Notes</p>
            {call.notes || lead?.notes}
          </div>
        )}

        <p className={cn(label, "mb-1.5")}>Résultat du call</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(Object.keys(STATUS_LABEL) as CallStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => void onAct({ action: "update-call", id: call.id, status }, `Call : ${STATUS_LABEL[status]}`)}
              className={cn("rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 ring-slate-900/10 dark:ring-white/10", call.status === status ? STATUS_TONE[status] : "bg-white dark:bg-slate-900")}
            >
              {call.status === status && <Check className="mr-1 inline h-3.5 w-3.5" />}
              {STATUS_LABEL[status]}
            </button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          placeholder="Ta note sur le call (objections, suite, montant…)"
          className="mb-2 w-full rounded-lg bg-slate-50 p-3 text-[13px] outline-none ring-1 ring-slate-900/10 focus:bg-white dark:bg-slate-800 dark:ring-white/10"
        />
        <button
          type="button"
          disabled={note === call.closerNote}
          onClick={() => void onAct({ action: "update-call", id: call.id, closerNote: note }, "Note enregistrée")}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
        >
          Enregistrer la note
        </button>

        {isAdmin && (
          <div className="mt-6 space-y-2 border-t border-slate-100 pt-4 dark:border-white/10">
            <p className={label}>Admin</p>
            <select
              value={call.closerId ?? ""}
              onChange={(event) => void onAct({ action: "assign-call", id: call.id, closerId: event.target.value || null }, "Closer mis à jour")}
              className={field}
            >
              <option value="">Sans closer</option>
              {closers.map((closer) => (
                <option key={closer.id} value={closer.id}>
                  {closer.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500">
              Source : {call.source === "ibostate" ? `IBOState (réservé au nom de « ${call.host} »)` : "ajouté à la main"}
            </p>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Supprimer le call de ${call.name} ?`)) void onAct({ action: "delete-call", id: call.id }, "Call supprimé").then((ok) => ok && onClose());
              }}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-rose-600"
            >
              <Trash2 className="h-3.5 w-3.5" /> Supprimer ce call
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmButtons({ call, onAct }: { call: CallView; onAct: (body: Record<string, unknown>, done?: string) => Promise<boolean> }) {
  const links = confirmLinks(call);
  const mark = () => void onAct({ action: "update-call", id: call.id, confirmed: true }, `Rendez-vous de ${call.name} confirmé`);
  if (!links) return <p className="text-[12px] text-rose-600">Pas de numéro pour ce prospect.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      <a href={links.whatsapp} target="_blank" rel="noreferrer" onClick={mark} className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-2 text-[13px] font-bold text-white">
        <MessageCircle className="h-4 w-4" /> WhatsApp
      </a>
      <a href={links.sms} onClick={mark} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-[13px] font-bold text-white dark:bg-white dark:text-slate-900">
        <MessageSquare className="h-4 w-4" /> SMS
      </a>
      <button type="button" onClick={mark} className="rounded-xl bg-slate-100 px-3 py-2 text-[12px] font-semibold dark:bg-slate-800">
        Déjà confirmé
      </button>
    </div>
  );
}

function ConfirmModal({
  calls,
  tz,
  onAct,
  onClose,
}: {
  calls: CallView[];
  tz: string;
  onAct: (body: Record<string, unknown>, done?: string) => Promise<boolean>;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 p-3 sm:items-center" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[18px] font-bold">
            <BellRing className="h-5 w-5 text-amber-500" /> {calls.length > 1 ? `${calls.length} rendez-vous à confirmer` : "Rendez-vous à confirmer"}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-[13px] text-slate-500">Un clic ouvre WhatsApp (ou tes SMS) avec le message déjà écrit : l&apos;heure chez le prospect et le lien du call. Tu n&apos;as plus qu&apos;à envoyer.</p>
        <div className="space-y-3">
          {calls.map((call) => (
            <div key={call.id} className="rounded-xl p-3 ring-1 ring-slate-900/[0.08] dark:ring-white/10">
              <p className="text-[15px] font-bold">{call.name}</p>
              <p className="mb-2 text-[12px] text-slate-500">
                {fmt(call.startAt, tz, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} ({tzLabel(tz)}) · chez lui {fmt(call.startAt, call.prospectTz, { hour: "2-digit", minute: "2-digit" })} ({tzLabel(call.prospectTz)})
              </p>
              <ConfirmButtons call={call} onAct={onAct} />
            </div>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-slate-100 py-2.5 text-[13px] font-semibold dark:bg-slate-800">
          Plus tard
        </button>
      </div>
    </div>
  );
}

function CriteriaCard({ open }: { open?: boolean }) {
  return (
    <details className={cn(card, "group")} open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[15px] font-bold">
        <span className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4" /> Critères de sélection IBOState
        </span>
        <span className="text-[12px] font-semibold text-slate-500 group-open:hidden">Voir</span>
        <span className="hidden text-[12px] font-semibold text-slate-500 group-open:inline">Masquer</span>
      </summary>
      <p className="mt-2 text-[12px] text-slate-500">
        À connaître par cœur : un seul critère non tenu = prospect non sélectionné (sauf les dettes fiscales, à noter seulement). Chaque fiche prospect les coche d&apos;après ses réponses ; ce qui reste « à demander », tu le vérifies pendant le call.
      </p>
      <ul className="mt-3 space-y-2 text-[13px]">
        {CRITERIA.map((criterion) => (
          <li key={criterion.key} className="flex gap-2">
            {criterion.soft ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
            <div>
              <p className="font-semibold">{criterion.title}</p>
              <p className="text-[12px] text-slate-500">{criterion.rule}</p>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function AdminPanel({ data, onAct }: { data: CloserPayload; onAct: (body: Record<string, unknown>, done?: string) => Promise<boolean> }) {
  const [form, setForm] = useState({ name: "", identifier: "", timezone: "Asia/Dubai", aliases: "" });
  const [call, setCall] = useState({ name: "", phone: "", email: "", start: "", durationMin: "15", joinUrl: "", closerId: "" });

  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast.success(`${what} copié`));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={card}>
        <h2 className="mb-1 text-[15px] font-bold">Closers</h2>
        <p className="mb-3 text-[12px] text-slate-500">
          Pas de mot de passe : chaque closer se connecte avec son lien personnel. « Nouveau lien » rend l&apos;ancien inutilisable ; « Couper » retire l&apos;accès tout de suite.
        </p>
        <div className="mb-4 space-y-2">
          {data.closers.length === 0 && <p className="text-[13px] text-slate-500">Aucun closer pour l&apos;instant.</p>}
          {data.closers.map((closer) => (
            <div key={closer.id} className={cn("rounded-xl p-3 ring-1 ring-slate-900/[0.06] dark:ring-white/[0.06]", !closer.active && "opacity-60")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[14px] font-bold">
                    {closer.name} <span className="font-normal text-slate-500">@{closer.identifier}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                    <select
                      value={closer.timezone}
                      onChange={(event) =>
                        void onAct(
                          { action: "save-closer", id: closer.id, name: closer.name, identifier: closer.identifier, timezone: event.target.value, aliases: closer.aliases },
                          `Fuseau de ${closer.name} : ${tzLabel(event.target.value)}`
                        )
                      }
                      className="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-slate-800"
                      aria-label={`Fuseau de ${closer.name}`}
                    >
                      {[...new Set([closer.timezone, ...TIMEZONES])].map((zone) => (
                        <option key={zone} value={zone}>
                          {zone.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                    · calls au nom de : {closer.aliases.length ? closer.aliases.join(", ") : closer.name}
                    {!closer.active && " · accès coupé"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => copy(closer.accessUrl, "Lien d'accès")} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white dark:bg-white dark:text-slate-900">
                    <Copy className="h-3 w-3" /> Lien d&apos;accès
                  </button>
                  <button type="button" onClick={() => void onAct({ action: "regenerate-link", id: closer.id }, "Nouveau lien créé : l'ancien ne marche plus")} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold dark:bg-slate-800">
                    Nouveau lien
                  </button>
                  <button type="button" onClick={() => void onAct({ action: "toggle-closer", id: closer.id, active: !closer.active }, closer.active ? "Accès coupé" : "Accès rétabli")} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold dark:bg-slate-800">
                    {closer.active ? "Couper" : "Rétablir"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Retirer ${closer.name} ? Ses calls passent « sans closer ».`)) void onAct({ action: "remove-closer", id: closer.id }, "Closer retiré");
                    }}
                    className="rounded-lg px-1.5 py-1 text-rose-600"
                    aria-label="Retirer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className={cn(label, "mb-1.5")}>Ajouter un closer</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Prénom (ex. Noura)" className={field} />
          <input value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="Identifiant (ex. noura)" className={field} />
          <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={field}>
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <input value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} placeholder="Calls au nom de (ex. Kelly)" className={field} />
        </div>
        <button
          type="button"
          onClick={() =>
            void onAct({ action: "save-closer", ...form, aliases: form.aliases }, `${form.name} ajouté : copie son lien d'accès`).then((ok) => {
              if (ok) setForm({ name: "", identifier: "", timezone: form.timezone, aliases: "" });
            })
          }
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" /> Ajouter
        </button>
      </div>

      <div className="space-y-4">
        <div className={card}>
          <h2 className="mb-1 text-[15px] font-bold">Réception IBOState</h2>
          <p className="text-[13px]">
            {data.ingestReady ? (
              <span className="text-emerald-700 dark:text-emerald-400">Branchée : chaque call réservé sur ibostate.com/book arrive ici, en même temps que sur Telegram.</span>
            ) : (
              <span className="text-amber-700">Pas encore branchée (clé de réception absente sur le serveur).</span>
            )}
          </p>
          <p className="mt-1 text-[12px] text-slate-500">
            Un call va au closer dont le champ « Calls au nom de » contient le nom d&apos;hôte reçu (IBOState réserve au nom de Kelly). Derniers leads reçus : {data.leads.length}.
          </p>
        </div>

        <div className={card}>
          <h2 className="mb-2 text-[15px] font-bold">Ajouter un call à la main</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={call.name} onChange={(e) => setCall({ ...call, name: e.target.value })} placeholder="Nom du prospect" className={field} />
            <input value={call.phone} onChange={(e) => setCall({ ...call, phone: e.target.value })} placeholder="Téléphone (+1…)" className={field} />
            <input value={call.email} onChange={(e) => setCall({ ...call, email: e.target.value })} placeholder="E-mail" className={field} />
            <input type="datetime-local" value={call.start} onChange={(e) => setCall({ ...call, start: e.target.value })} className={field} title="À ton heure (celle de ce navigateur)" />
            <input value={call.joinUrl} onChange={(e) => setCall({ ...call, joinUrl: e.target.value })} placeholder="Lien du call (Meet, Zoom…)" className={field} />
            <select value={call.closerId} onChange={(e) => setCall({ ...call, closerId: e.target.value })} className={field}>
              <option value="">Sans closer</option>
              {data.closers.map((closer) => (
                <option key={closer.id} value={closer.id}>
                  {closer.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() =>
              void onAct(
                {
                  action: "add-call",
                  call: { name: call.name, phone: call.phone, email: call.email, startAt: call.start ? new Date(call.start).toISOString() : "", durationMin: Number(call.durationMin), joinUrl: call.joinUrl, closerId: call.closerId || null },
                },
                "Call ajouté"
              ).then((ok) => {
                if (ok) setCall({ name: "", phone: "", email: "", start: "", durationMin: "15", joinUrl: "", closerId: call.closerId });
              })
            }
            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white dark:bg-white dark:text-slate-900"
          >
            <Plus className="h-3.5 w-3.5" /> Ajouter le call
          </button>
          <p className="mt-1 text-[11px] text-slate-500">L&apos;heure se saisit à ton heure ; chaque closer la voit à la sienne.</p>
        </div>

        {data.leads.length > 0 && (
          <div className={card}>
            <h2 className="mb-2 text-[15px] font-bold">Derniers leads</h2>
            <ul className="space-y-1 text-[12px]">
              {data.leads.slice(0, 8).map((lead) => (
                <li key={lead.id} className="flex justify-between gap-2">
                  <span className="truncate font-medium">{lead.name || lead.email}</span>
                  <span className="shrink-0 text-slate-500">
                    {lead.place || "—"} · {fmt(lead.receivedAt, Intl.DateTimeFormat().resolvedOptions().timeZone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
            <a href="https://t.me/ibostate_leads_bot" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-sky-600">
              <ExternalLink className="h-3.5 w-3.5" /> Bot Telegram
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
