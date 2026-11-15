"use client";

/**
 * « Ajouter un BM » : brancher un Business Manager à l'API depuis le haut du
 * Meta Ads Manager, avec son nom et le jeton d'accès de son utilisateur système.
 *
 * Le jeton est vérifié chez Meta avant d'être gardé, et la réponse montre les
 * comptes publicitaires qu'il voit : on sait tout de suite si c'est le bon. Les
 * comptes qu'on attribuera plus tard à ce même utilisateur système arrivent
 * seuls dans le CRM, rangés dans « Flux comptes → Nouveaux ». Le jeton n'est
 * jamais réaffiché : seuls le nom du BM et la date restent visibles.
 */

import { useState } from "react";
import { Building2, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type StoredToken = { id: string; label: string; addedAt: string };
type Retired = { id: string; reason: string; at: string; source: "env" | "registre" };
type FoundAccount = { accountId: string; name: string; status: number; currency: string; business: string };

const STATUS: Record<number, string> = { 1: "actif", 2: "désactivé", 3: "impayé", 7: "en examen", 9: "délai de grâce", 100: "fermeture", 101: "fermé" };

export function ConnectBmButton({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokens, setTokens] = useState<StoredToken[]>([]);
  const [retired, setRetired] = useState<Retired[]>([]);
  const [found, setFound] = useState<{ label: string; accounts: FoundAccount[] } | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/meta/registry");
      const body = await res.json();
      if (res.ok) {
        setTokens(body.tokens || []);
        setRetired(body.retired || []);
      }
    } catch {
      // la liste reste vide, l'ajout fonctionne quand même
    }
  }

  async function connect() {
    if (!label.trim() || !token.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/meta/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-token", label: label.trim(), token: token.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Jeton refusé");
      setTokens(body.tokens || []);
      setFound({ label: label.trim(), accounts: body.accounts || [] });
      setToken("");
      setLabel("");
      toast.success(body.created ? `BM branché : ${(body.accounts || []).length} compte(s) visibles` : "Ce jeton était déjà branché");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Branchement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: StoredToken) {
    if (!window.confirm(`Débrancher « ${row.label} » ? Ses comptes disparaîtront du CRM s'ils ne sont vus par aucun autre jeton.`)) return;
    try {
      const res = await fetch("/api/meta/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove-token", id: row.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Impossible");
      setTokens(body.tokens || []);
      toast.success(`« ${row.label} » débranché`);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setFound(null);
          void load();
        }}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 text-[11px] font-medium text-white hover:bg-slate-700 sm:h-9 dark:bg-slate-100 dark:text-slate-900"
      >
        <Plus className="h-3.5 w-3.5" />
        Ajouter un BM
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Brancher un Business Manager
            </DialogTitle>
            <DialogDescription>
              Le nom du BM et le jeton d&apos;accès de son utilisateur système (droits ads_management, ads_read, business_management).
              Les comptes attribués plus tard à cet utilisateur arriveront seuls dans « Flux comptes → Nouveaux ».
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Nom du BM (ex. Kepis Durian Station)"
              className="h-9 w-full rounded-lg bg-slate-50 px-3 text-[13px] outline-none ring-1 ring-slate-900/10 focus:bg-white dark:bg-slate-800"
            />
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Coller le jeton d'accès Meta"
              className="h-9 w-full rounded-lg bg-slate-50 px-3 font-mono text-[12px] outline-none ring-1 ring-slate-900/10 focus:bg-white dark:bg-slate-800"
            />
            <button
              type="button"
              disabled={busy || !label.trim() || !token.trim()}
              onClick={() => void connect()}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-[13px] font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Vérifier et brancher
            </button>
          </div>

          {found ? (
            <div className="rounded-lg bg-emerald-50 p-2.5 text-[12px] dark:bg-emerald-500/10">
              <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                « {found.label} » branché — {found.accounts.length} compte(s) publicitaire(s) visibles
              </p>
              <ul className="mt-1 space-y-0.5 text-slate-600 dark:text-slate-300">
                {found.accounts.map((account) => (
                  <li key={account.accountId} className="flex gap-2">
                    <span className="font-medium">{account.name}</span>
                    <span className="text-slate-400">act_{account.accountId}</span>
                    <span className={cn(account.status === 1 ? "text-emerald-700" : "text-rose-600")}>{STATUS[account.status] ?? `statut ${account.status}`}</span>
                  </li>
                ))}
                {!found.accounts.length ? <li>Aucun compte attribué à ce jeton pour l&apos;instant : ils apparaîtront dès qu&apos;on lui en donne.</li> : null}
              </ul>
            </div>
          ) : null}

          {tokens.length ? (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">BM branchés</p>
              {tokens.map((row) => (
                <div key={row.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] dark:bg-slate-800/60">
                  <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                  <span className="text-[10px] text-slate-400">{row.addedAt.slice(0, 10)}</span>
                  {retired.some((item) => item.id === row.id) ? (
                    <span className="rounded bg-rose-100 px-1 text-[10px] font-semibold text-rose-700">jeton mort</span>
                  ) : null}
                  <button type="button" onClick={() => void remove(row)} title="Débrancher" className="text-slate-400 hover:text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {retired.length ? (
            <p className="text-[11px] text-slate-400">
              {retired.length} jeton(s) écarté(s) automatiquement parce que Meta les déclare morts ({[...new Set(retired.map((row) => row.reason.split(".")[0]))].join(" · ")}). Ils sont retentés au bout de 7 jours.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
