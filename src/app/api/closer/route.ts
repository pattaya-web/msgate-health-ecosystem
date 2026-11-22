import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/request";
import {
  cleanIdentifier,
  closerForHost,
  leadFor,
  newAccessToken,
  newId,
  readClosers,
  updateClosers,
  validTimezone,
  type CallStatus,
  type Closer,
  type CloserCall,
  type CloserLead,
  type CloserStore,
} from "@/lib/closer/store";
import { loadAuthUsers } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

export type CallView = CloserCall & { lead: CloserLead | null; closerName: string };
export type CloserView = Omit<Closer, "accessToken" | "passwordHash"> & { accessUrl: string; hasPassword: boolean };
export type CloserPayload = {
  role: "admin" | "closer";
  me: { name: string; timezone: string } | null;
  closers: CloserView[];
  calls: CallView[];
  leads: CloserLead[];
  ingestReady: boolean;
};

function baseUrl(request: Request) {
  const env = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (env) return env;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

function viewOf(store: CloserStore, calls: CloserCall[]): CallView[] {
  const names = new Map(store.closers.map((closer) => [closer.id, closer.name]));
  const leads = new Map(store.leads.map((lead) => [lead.id, lead]));
  return calls.map((call) => ({
    ...call,
    lead: (call.leadId && leads.get(call.leadId)) || leadFor(store.leads, call.phone, call.email),
    closerName: (call.closerId && names.get(call.closerId)) || "",
  }));
}

function payloadFor(request: Request, store: CloserStore, role: "admin" | "closer", identifier: string): CloserPayload {
  const base = baseUrl(request);
  if (role === "closer") {
    const me = store.closers.find((closer) => closer.identifier === identifier && closer.active);
    return {
      role,
      me: me ? { name: me.name, timezone: me.timezone } : null,
      closers: [],
      calls: me ? viewOf(store, store.calls.filter((call) => call.closerId === me.id)) : [],
      leads: [],
      ingestReady: true,
    };
  }
  return {
    role,
    me: null,
    closers: store.closers.map(({ accessToken, passwordHash, ...closer }) => ({ ...closer, accessUrl: `${base}/api/closer/acces?t=${accessToken}`, hasPassword: Boolean(passwordHash) })),
    calls: viewOf(store, store.calls),
    leads: store.leads.slice(0, 50),
    ingestReady: (process.env.CLOSER_INGEST_KEY?.trim().length ?? 0) >= 24,
  };
}

export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
  if (session.role !== "admin" && session.role !== "closer") return NextResponse.json({ error: "Réservé à l'admin et aux closers" }, { status: 403 });
  return NextResponse.json(payloadFor(request, await readClosers(), session.role, session.email));
}

type Body = {
  action?: string;
  id?: string;
  name?: string;
  identifier?: string;
  timezone?: string;
  aliases?: string[] | string;
  active?: boolean;
  closerId?: string | null;
  status?: CallStatus;
  closerNote?: string;
  password?: string;
  confirmed?: boolean;
  call?: Partial<CloserCall>;
};

const STATUSES: CallStatus[] = ["booked", "done", "no-show", "cancelled"];

export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
  const isAdmin = session.role === "admin";
  if (!isAdmin && session.role !== "closer") return NextResponse.json({ error: "Réservé à l'admin et aux closers" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.action) return NextResponse.json({ error: "Requête illisible" }, { status: 400 });

  try {
    // Le hachage prend du temps : il se fait avant d'ouvrir le fichier des closers.
    const password = isAdmin && body.action === "set-password" ? String(body.password ?? "").trim() : "";
    const passwordHash = password.length >= 4 ? await hashPassword(password) : "";
    const store = await updateClosers((store) => {
      const fail = (message: string): never => {
        throw new Error(message);
      };

      // Le closer ne touche qu'au statut et à la note de SES calls.
      if (body.action === "update-call") {
        const call = store.calls.find((item) => item.id === body.id) ?? fail("Call introuvable");
        if (!isAdmin) {
          const me = store.closers.find((closer) => closer.identifier === session.email && closer.active);
          if (!me || call.closerId !== me.id) fail("Ce call n'est pas dans ton agenda");
        }
        if (body.status && STATUSES.includes(body.status)) call.status = body.status;
        if (typeof body.closerNote === "string") call.closerNote = body.closerNote.slice(0, 2000);
        if (typeof body.confirmed === "boolean") call.confirmedAt = body.confirmed ? new Date().toISOString() : null;
        call.updatedAt = new Date().toISOString();
        return store;
      }

      if (!isAdmin) fail("Réservé à l'admin");

      if (body.action === "save-closer") {
        const name = String(body.name ?? "").trim().slice(0, 60);
        const identifier = cleanIdentifier(String(body.identifier ?? "") || name);
        const timezone = String(body.timezone ?? "").trim();
        const aliases = (Array.isArray(body.aliases) ? body.aliases : String(body.aliases ?? "").split(","))
          .map((alias) => alias.trim())
          .filter(Boolean)
          .slice(0, 10);
        if (!name) fail("Le prénom du closer est requis");
        if (identifier.length < 2) fail("Identifiant trop court");
        if (!validTimezone(timezone)) fail("Fuseau horaire inconnu");
        // Un identifiant de closer ne doit pas reprendre un compte existant (Mady, Noah…).
        if (loadAuthUsers().users.some((user) => user.email === identifier)) fail("Cet identifiant est déjà pris par un compte du CRM");
        if (store.closers.some((closer) => closer.identifier === identifier && closer.id !== body.id)) fail("Cet identifiant est déjà pris par un autre closer");
        const existing = body.id ? store.closers.find((closer) => closer.id === body.id) : null;
        if (existing) Object.assign(existing, { name, identifier, timezone, aliases });
        else
          store.closers.push({ id: newId(), name, identifier, timezone, aliases, accessToken: newAccessToken(), active: true, createdAt: new Date().toISOString() });
        // Les calls déjà reçus pour un de ses noms d'hôte lui reviennent.
        for (const call of store.calls) if (!call.closerId) call.closerId = closerForHost(store.closers, call.host)?.id ?? null;
        return store;
      }

      if (body.action === "regenerate-link") {
        const closer = store.closers.find((item) => item.id === body.id) ?? fail("Closer introuvable");
        closer.accessToken = newAccessToken();
        return store;
      }

      if (body.action === "set-password") {
        const closer = store.closers.find((item) => item.id === body.id) ?? fail("Closer introuvable");
        if (!passwordHash) fail("Mot de passe trop court (4 caractères minimum)");
        closer.passwordHash = passwordHash;
        return store;
      }

      if (body.action === "toggle-closer") {
        const closer = store.closers.find((item) => item.id === body.id) ?? fail("Closer introuvable");
        closer.active = Boolean(body.active);
        return store;
      }

      if (body.action === "remove-closer") {
        const index = store.closers.findIndex((item) => item.id === body.id);
        if (index < 0) fail("Closer introuvable");
        const [removed] = store.closers.splice(index, 1);
        for (const call of store.calls) if (call.closerId === removed.id) call.closerId = null;
        return store;
      }

      if (body.action === "assign-call") {
        const call = store.calls.find((item) => item.id === body.id) ?? fail("Call introuvable");
        if (body.closerId && !store.closers.some((closer) => closer.id === body.closerId)) fail("Closer introuvable");
        call.closerId = body.closerId || null;
        call.updatedAt = new Date().toISOString();
        return store;
      }

      if (body.action === "add-call") {
        const input = body.call ?? {};
        const start = new Date(String(input.startAt ?? ""));
        if (!String(input.name ?? "").trim()) fail("Nom du prospect requis");
        if (Number.isNaN(start.getTime())) fail("Date et heure du call requises");
        const now = new Date().toISOString();
        store.calls.push({
          id: newId(),
          closerId: input.closerId || null,
          host: "",
          startAt: start.toISOString(),
          durationMin: Math.min(Math.max(Number(input.durationMin) || 15, 5), 240),
          prospectTz: validTimezone(String(input.prospectTz ?? "")) ? String(input.prospectTz) : "America/New_York",
          joinUrl: /^https:\/\//.test(String(input.joinUrl ?? "")) ? String(input.joinUrl) : "",
          name: String(input.name).trim().slice(0, 120),
          phone: String(input.phone ?? "").trim().slice(0, 40),
          email: String(input.email ?? "").trim().slice(0, 160),
          notes: String(input.notes ?? "").trim().slice(0, 600),
          answers: [],
          leadId: null,
          status: "booked",
          closerNote: "",
          source: "manual",
          createdAt: now,
          updatedAt: now,
        });
        store.calls.sort((a, b) => a.startAt.localeCompare(b.startAt));
        return store;
      }

      if (body.action === "delete-call") {
        const index = store.calls.findIndex((item) => item.id === body.id);
        if (index < 0) fail("Call introuvable");
        store.calls.splice(index, 1);
        return store;
      }

      return fail("Action inconnue");
    });
    return NextResponse.json(payloadFor(request, store, isAdmin ? "admin" : "closer", session.email));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action impossible" }, { status: 400 });
  }
}
