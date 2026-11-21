import {
  closerForHost,
  leadFor,
  newId,
  phoneDigits,
  updateClosers,
  type Answer,
  type CloserCall,
  type CloserLead,
} from "@/lib/closer/store";

/**
 * Ce qu'IBOState envoie, tel quel (api/notify-lead.js du projet ibostate) :
 * `{ type: "booking", payload }` pour un call réservé sur /book/,
 * `{ type: "lead", payload }` pour un formulaire rempli. Les mêmes données
 * partent sur Telegram ; ici on les range.
 */

type Raw = Record<string, unknown>;

const str = (value: unknown, max = 300) => (value == null ? "" : String(value)).trim().slice(0, max);

function obj(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function answer(label: string, value: unknown): Answer | null {
  const text = str(value, 120);
  return text && text !== "—" ? { label, value: text } : null;
}

const QUAL_LABELS: Array<[string, string]> = [
  ["criminal_record", "Casier judiciaire"],
  ["credit_score", "Score de crédit"],
  ["has_llc", "A déjà une LLC"],
  ["understands", "Comprend le programme"],
  ["camera_on", "À l'heure"],
];

export async function ingestBooking(payload: Raw) {
  const start = new Date(str(payload.start_iso, 40));
  if (!str(payload.name) || !str(payload.phone) || Number.isNaN(start.getTime())) throw new Error("Réservation incomplète (nom, téléphone, heure)");
  const qual = obj(payload.qual);
  const answers = QUAL_LABELS.map(([key, label]) => answer(label, qual[key])).filter((item): item is Answer => Boolean(item));
  const meet = str(payload.meet_url, 200);

  return updateClosers((store) => {
    const host = str(payload.host, 60) || "Kelly";
    const digits = phoneDigits(str(payload.phone));
    const now = new Date().toISOString();
    const lead = leadFor(store.leads, str(payload.phone), str(payload.email));
    // La même réservation renvoyée (rechargement de page) ne fait pas deux calls.
    const existing = store.calls.find((call) => call.startAt === start.toISOString() && phoneDigits(call.phone) === digits);
    const call: CloserCall = {
      id: existing?.id ?? newId(),
      closerId: existing?.closerId ?? closerForHost(store.closers, host)?.id ?? null,
      host,
      startAt: start.toISOString(),
      durationMin: Math.min(Math.max(Number(payload.duration_minutes) || 15, 5), 240),
      prospectTz: str(payload.prospect_tz, 60) || "America/New_York",
      joinUrl: /^https:\/\//.test(meet) ? meet : "",
      name: str(payload.name, 120),
      phone: str(payload.phone, 40),
      email: str(payload.email, 160),
      notes: str(payload.notes, 600),
      answers,
      leadId: lead?.id ?? existing?.leadId ?? null,
      status: existing?.status ?? "booked",
      closerNote: existing?.closerNote ?? "",
      source: "ibostate",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) Object.assign(existing, call);
    else store.calls.push(call);
    store.calls.sort((a, b) => a.startAt.localeCompare(b.startAt));
    if (store.calls.length > 5000) store.calls.splice(0, store.calls.length - 5000);
    return call;
  });
}

export async function ingestLead(payload: Raw) {
  const identity = obj(payload.identity);
  const address = obj(payload.address);
  const name = str(payload.full_name, 120) || [str(identity.firstName), str(identity.lastName)].filter(Boolean).join(" ");
  const email = str(obj(payload.email).email, 160) || str(payload.email, 160);
  const phone = str(obj(payload.phone).phone, 40) || str(payload.phone, 40);
  if (!name && !email && !phone) throw new Error("Lead vide");
  const status = str(obj(payload.ibostates_eligibility).status, 30);
  const answers = [
    answer("Score de crédit", payload.credit_score ?? obj(payload.creditScore).choice),
    answer("Statut pro", payload.employment_status),
    answer("Compte bancaire US", payload.has_bank_account),
    answer("Dettes fiscales / saisies", payload.has_tax_liens),
    answer("Citoyen / résident US", payload.us_resident),
  ].filter((item): item is Answer => Boolean(item));

  return updateClosers((store) => {
    const existing = leadFor(store.leads, phone, email);
    const lead: CloserLead = {
      id: existing?.id ?? newId(),
      name,
      email,
      phone,
      place: [str(address.city, 60), str(address.state, 40)].filter(Boolean).join(", "),
      telegram: str(payload.telegram, 60),
      preferredContact: str(payload.communication_preference, 60),
      eligibility: status === "qualified" || status === "disqualified" ? status : "review",
      answers,
      notes: str(payload.notes, 600),
      receivedAt: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, lead);
    else store.leads.unshift(lead);
    if (store.leads.length > 5000) store.leads.length = 5000;
    // Un call déjà réservé par ce prospect récupère sa fiche.
    for (const call of store.calls) {
      if (!call.leadId && leadFor([lead], call.phone, call.email)) call.leadId = lead.id;
    }
    return lead;
  });
}
