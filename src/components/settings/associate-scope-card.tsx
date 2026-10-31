"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Eye, Lock, Save } from "lucide-react";
import { toast } from "sonner";
import type { AssociateScope } from "@/lib/associate/scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/phoenix/multi-select";

type Options = { stores: string[]; accounts: Array<{ id: string; name: string; business: string }> };

/**
 * Le périmètre de l'accès Associé, réglé par l'admin.
 *
 * Ce que l'associé voit se décide ici et nulle part ailleurs : les boutiques
 * dont on compte les ventes directes, les comptes Meta dont on compte la
 * dépense, et un mot-clé pour attraper les campagnes « Straight Sale » d'un
 * compte partagé. Le serveur applique ces choix ; la page de l'associé ne
 * fait que les afficher.
 */
export function AssociateScopeCard({ isAdmin, icon }: { isAdmin: boolean; icon?: ReactNode }) {
  const [scope, setScope] = useState<AssociateScope | null>(null);
  const [options, setOptions] = useState<Options>({ stores: [], accounts: [] });
  const [stores, setStores] = useState<string[]>([]);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [processingRate, setProcessingRate] = useState("");
  const [targetMargin, setTargetMargin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void fetch("/api/associate/scope", { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as { scope?: AssociateScope; options?: Options; error?: string };
        if (!alive) return;
        if (!res.ok || !body.scope) throw new Error(body.error || `HTTP ${res.status}`);
        setScope(body.scope);
        setOptions(body.options ?? { stores: [], accounts: [] });
        setStores(body.scope.stores);
        setAccountIds(body.scope.metaAccountIds);
        setKeyword(body.scope.campaignKeyword);
        setProcessingRate(String(body.scope.processingRate ?? ""));
        setTargetMargin(String(body.scope.targetMargin ?? ""));
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : "Périmètre illisible");
      });
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  const accountLabel = (id: string) => {
    const account = options.accounts.find((entry) => entry.id === id);
    return account ? `${account.name} (${id})` : id;
  };
  // Le sélecteur travaille sur des libellés ; on repasse à l'identifiant en sortie.
  const accountOptions = [...new Set([...options.accounts.map((account) => account.id), ...accountIds])].map(accountLabel);
  const idOf = (label: string) => options.accounts.find((entry) => accountLabel(entry.id) === label)?.id ?? label;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/associate/scope", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stores, metaAccountIds: accountIds, campaignKeyword: keyword, processingRate, targetMargin }),
      });
      const body = (await res.json()) as { scope?: AssociateScope; error?: string };
      if (!res.ok || !body.scope) throw new Error(body.error || `HTTP ${res.status}`);
      setScope(body.scope);
      toast.success("Périmètre Associé enregistré");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    !!scope &&
    (stores.join("|") !== scope.stores.join("|") ||
      accountIds.join("|") !== scope.metaAccountIds.join("|") ||
      keyword.trim() !== scope.campaignKeyword ||
      Number(processingRate) !== scope.processingRate ||
      Number(targetMargin) !== scope.targetMargin);

  return (
    <Card>
      <CardHeader>
        {/* Sur téléphone, les deux boutons passent sous le titre. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {icon}
              Périmètre Associé · Straight Sale
              {!isAdmin ? (
                <Badge variant="outline" className="gap-1 font-normal">
                  <Lock className="h-3 w-3" />
                  Admin only
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              Ce que voit un compte « associé » : les ventes directes des boutiques choisies et la dépense des comptes Meta retenus. Rien d&apos;autre ne lui est servi.
            </CardDescription>
          </div>
          {isAdmin ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href="/associate">
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                  Voir comme l&apos;associé
                </Link>
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Enregistrer
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isAdmin ? (
          <p className="text-sm text-slate-500">Seul l&apos;admin règle ce périmètre.</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Boutiques (ventes directes)</Label>
              <MultiSelect options={[...new Set([...options.stores, ...stores])]} value={stores} onChange={setStores} placeholder="Toutes les boutiques" />
              <p className="text-xs text-slate-500">Vide : toutes les boutiques du compte Phoenix.</p>
            </div>
            <div className="space-y-2">
              <Label>Comptes Meta Ads retenus en entier</Label>
              <MultiSelect
                options={accountOptions}
                value={accountIds.map(accountLabel)}
                onChange={(labels) => setAccountIds(labels.map(idOf))}
                placeholder="Aucun compte"
              />
              <p className="text-xs text-slate-500">Toute la dépense de ces comptes compte pour Straight Sale.</p>
            </div>
            <div className="space-y-2">
              <Label>Frais de paiement estimés (%)</Label>
              <Input inputMode="decimal" value={processingRate} onChange={(event) => setProcessingRate(event.target.value)} placeholder="4" />
              <p className="text-xs text-slate-500">Retirés du chiffre d&apos;affaires dans le profit de l&apos;associé.</p>
            </div>
            <div className="space-y-2">
              <Label>Marge nette visée (%)</Label>
              <Input inputMode="decimal" value={targetMargin} onChange={(event) => setTargetMargin(event.target.value)} placeholder="20" />
              <p className="text-xs text-slate-500">Fixe le ROAS cible affiché à l&apos;associé.</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Mot-clé de campagne</Label>
              <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="ex. straight, SS, direct" maxLength={60} />
              <p className="text-xs text-slate-500">
                Sur les autres comptes, seules les campagnes dont le nom contient ce mot comptent. Vide : seuls les comptes retenus comptent.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
