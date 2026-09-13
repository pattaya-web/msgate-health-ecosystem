"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ImagePlus, Loader2, Plus, RefreshCw, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CREATIVE_TYPES } from "@/lib/studio/creative-types";
import { RATIOS, type Ratio } from "@/lib/studio/ratios";
import { EMPHASES, isDigitalClass, type Angle, type CreativeEmphasis, type FamilyGroup, type PlanSummary, type ProductContext, type ReferenceStrength, type TestBatch } from "@/lib/creative-engine/types";
import { chip, enginePost, fileToDataUrl } from "@/components/mass-test/engine-client";
import { AnglePicker, StylePicker } from "@/components/mass-test/pickers";
import { cn } from "@/lib/utils";

/**
 * Étapes 2 et 3 : ce qu'on teste, combien on génère. La page ne montre que
 * les choix faits ; les listes complètes vivent dans des fenêtres, les
 * réglages techniques dans « Options avancées ». Un seul bouton compte.
 */

const DEFAULT_PRESETS = ["before-after", "ugc", "product-focus"];
const STRENGTHS: Array<{ id: ReferenceStrength; label: string; hint: string }> = [
  { id: "low", label: "Faible", hint: "Inspiration générale seulement" },
  { id: "medium", label: "Moyenne", hint: "Même structure publicitaire" },
  { id: "high", label: "Forte", hint: "Composition suivie de près, contenu adapté" },
];

const label = "mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500";

function SelectedCard({ title, hint, onRemove }: { title: string; hint?: string; onRemove: () => void }) {
  return (
    <div className="group relative rounded-xl bg-slate-900 px-3.5 py-2.5 text-white dark:bg-white dark:text-slate-900">
      <div className="pr-5 text-[13px] font-semibold">{title}</div>
      {hint ? <div className="truncate pr-5 text-[11px] opacity-70">{hint}</div> : null}
      <button type="button" onClick={onRemove} className="absolute right-2 top-2 rounded p-0.5 opacity-60 hover:opacity-100" aria-label={`Retirer ${title}`}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function TestBuilder({ product, onProductChanged, onLaunched }: { product: ProductContext | null; onProductChanged: () => Promise<void>; onLaunched: (batch: TestBatch) => void }) {
  const angles = useMemo<Angle[]>(() => (product ? [...product.suggestedAngles, ...product.customAngles] : []), [product]);
  const [angleIds, setAngleIds] = useState<string[]>([]);
  const [presetIds, setPresetIds] = useState<string[]>(DEFAULT_PRESETS.filter((id) => CREATIVE_TYPES.some((type) => type.id === id && type.enabled)));
  const [variations, setVariations] = useState(3);
  const [direction, setDirection] = useState("");
  const [references, setReferences] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [strength, setStrength] = useState<ReferenceStrength>("medium");
  const [ratio, setRatio] = useState<Ratio>("3:4");
  const [resolution, setResolution] = useState<"1K" | "2K">("1K");
  const [advanced, setAdvanced] = useState(false);
  const [picker, setPicker] = useState<"angles" | "styles" | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /* Ce qui domine la créa : recommandé par l'analyse, modifiable d'un clic. */
  const [emphasis, setEmphasis] = useState<CreativeEmphasis>("balanced");
  const [physicalMockup, setPhysicalMockup] = useState(false);
  const [mixMode, setMixMode] = useState<"auto" | "custom">("auto");
  const [mix, setMix] = useState<Record<FamilyGroup, number>>({ transformation: 6, feature: 4, social: 3, product: 2 });
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planning, setPlanning] = useState(false);
  const digital = isDigitalClass(product?.analysis?.productClass);

  useEffect(() => {
    const recommended = product?.analysis?.recommendedEmphasis;
    const timer = setTimeout(() => setEmphasis(recommended ?? "balanced"), 0);
    return () => clearTimeout(timer);
  }, [product?.id, product?.analysis?.recommendedEmphasis]);

  /* Produit changé : le protocole recommandé, les cinq premiers angles proposés. */
  useEffect(() => {
    const timer = setTimeout(() => setAngleIds(angles.slice(0, 5).map((angle) => angle.id)), 0);
    return () => clearTimeout(timer);
  }, [product?.id, angles.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosenAngles = angleIds.map((id) => angles.find((angle) => angle.id === id)).filter((angle): angle is Angle => Boolean(angle));
  const chosenPresets = presetIds.map((id) => CREATIVE_TYPES.find((type) => type.id === id)).filter((type): type is (typeof CREATIVE_TYPES)[number] => Boolean(type));
  const total = chosenAngles.length * variations;

  function specBody(nextSeed = seed) {
    return {
      productId: product?.id,
      angleIds,
      presetIds,
      variationsPerAngle: variations,
      ratio,
      resolution,
      referenceDataUrls: references.map((reference) => reference.dataUrl),
      referenceStrength: strength,
      instructions: direction,
      emphasis,
      physicalMockup,
      familyMix: mixMode === "custom" ? { mode: "custom", counts: mix } : { mode: "auto" },
      seed: nextSeed,
    };
  }

  /** Le plan seul, sans crédit : pour voir la diversité avant de payer. Une nouvelle graine = un nouveau plan. */
  async function loadPlan(regenerate = false) {
    if (!product || !total) return;
    const nextSeed = regenerate ? Math.floor(Math.random() * 1e6) : seed;
    if (regenerate) setSeed(nextSeed);
    setPlanning(true);
    try {
      const body = await enginePost<{ plan: PlanSummary }>({ action: "plan", ...specBody(nextSeed) });
      setPlan(body.plan);
      setPlanOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Plan impossible");
    } finally {
      setPlanning(false);
    }
  }

  async function addCustomAngle(name: string) {
    if (!product) return;
    try {
      const body = await enginePost<{ product: ProductContext }>({ action: "product-update", productId: product.id, addAngle: { name } });
      await onProductChanged();
      const added = body.product.customAngles[body.product.customAngles.length - 1];
      if (added) setAngleIds((current) => [...current, added.id]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Angle impossible");
    }
  }

  async function removeCustomAngle(id: string) {
    if (!product) return;
    try {
      await enginePost({ action: "product-update", productId: product.id, removeAngleId: id });
      setAngleIds((current) => current.filter((item) => item !== id));
      await onProductChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    }
  }

  async function addReferences(files: FileList | null) {
    if (!files?.length) return;
    const next = await Promise.all([...files].slice(0, 3 - references.length).map(async (file) => ({ name: file.name, dataUrl: await fileToDataUrl(file) })));
    setReferences((current) => [...current, ...next].slice(0, 3));
  }

  async function generate() {
    if (!product) return toast.error("Choisis un produit");
    if (!chosenAngles.length) return toast.error("Choisis au moins un angle");
    if (!chosenPresets.length) return toast.error("Choisis au moins un style");
    if (!window.confirm(`Générer ${total} créa${total > 1 ? "s" : ""} chez Kie ?`)) return;
    setBusy(true);
    try {
      const body = await enginePost<{ batch: TestBatch }>({ action: "generate", ...specBody() });
      toast.success(`Lot #${String(body.batch.number).padStart(3, "0")} lancé · ${body.batch.items.length} créas`);
      onLaunched(body.batch);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lancement impossible");
    } finally {
      setBusy(false);
    }
  }

  if (!product) return null;

  const cta = (
    <Button className="h-12 w-full text-[14px] font-semibold" onClick={() => void generate()} disabled={busy || !total}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
      Générer {total} créa{total > 1 ? "s" : ""}
    </Button>
  );

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="space-y-10">
        {/* ---------------- 2. Stratégie de test ---------------- */}
        <section>
          <h2 className="mb-1 text-[15px] font-semibold text-slate-900 dark:text-slate-100">2. Qu&apos;est-ce qu&apos;on teste ?</h2>
          <p className="mb-5 text-[12px] text-slate-500">Un angle est une raison d&apos;acheter. Un style est la forme de la pub. Chaque angle sort dans chaque style.</p>

          <div className="mb-6">
            <div className={label}>Angles</div>
            {chosenAngles.length ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {chosenAngles.map((angle) => (
                  <SelectedCard key={angle.id} title={angle.name} hint={angle.hooks[0] ? `« ${angle.hooks[0]} »` : undefined} onRemove={() => setAngleIds((current) => current.filter((id) => id !== angle.id))} />
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-slate-500">Aucun angle choisi.</p>
            )}
            <button type="button" onClick={() => setPicker("angles")} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-slate-700 hover:underline dark:text-slate-200">
              <Plus className="h-3.5 w-3.5" />
              Changer les angles
            </button>
          </div>

          <div>
            <div className={label}>Styles de créa</div>
            {chosenPresets.length ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {chosenPresets.map((type) => (
                  <SelectedCard key={type.id} title={type.name} hint={type.description} onRemove={() => setPresetIds((current) => current.filter((id) => id !== type.id))} />
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-slate-500">Aucun style choisi.</p>
            )}
            <button type="button" onClick={() => setPicker("styles")} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-slate-700 hover:underline dark:text-slate-200">
              <Plus className="h-3.5 w-3.5" />
              Changer les styles
            </button>
          </div>

          <div className="mt-6">
            <div className={label}>Ce qui domine la créa</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {EMPHASES.map((entry) => (
                <button key={entry.id} type="button" onClick={() => setEmphasis(entry.id)} title={entry.hint} className={chip(emphasis === entry.id, "px-3.5 py-1.5 text-[12px]")}>
                  {entry.label}
                  {product?.analysis?.recommendedEmphasis === entry.id ? <span className="ml-1 opacity-60">· recommandé</span> : null}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {emphasis === "outcome" ? "Le résultat domine : le produit reste petit ou absent." : emphasis === "balanced" ? "Résultat et produit à poids égal." : "Le produit est le héros de la créa."}
              {digital && !physicalMockup ? " Produit digital : jamais transformé en livre ou en boîte." : ""}
            </p>
          </div>
        </section>

        <section>
          <div className={label}>Direction créative supplémentaire · facultatif</div>
          <textarea
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
            rows={3}
            placeholder="Ex. : transformation agressive, contraste avant/après fort, cible masculine, style direct-response premium…"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[13px] leading-relaxed placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950"
          />
        </section>

        {/* ---------------- 3. Lot ---------------- */}
        <section>
          <h2 className="mb-4 text-[15px] font-semibold text-slate-900 dark:text-slate-100">3. Lot</h2>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div>
              <div className={label}>Angles</div>
              <div className="text-[22px] font-semibold tabular-nums text-slate-900 dark:text-slate-100">{chosenAngles.length}</div>
            </div>
            <div className="text-[22px] text-slate-300">×</div>
            <div>
              <div className={label}>Variantes par angle</div>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 5].map((count) => (
                  <button key={count} type="button" onClick={() => setVariations(count)} className={chip(variations === count, "px-3.5 py-1.5 text-[13px]")}>
                    {count}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={variations}
                  onChange={(event) => setVariations(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}
                  className="h-8 w-16 rounded-full border border-slate-200 px-2 text-center text-[12px] tabular-nums dark:border-slate-700 dark:bg-slate-950"
                  aria-label="Nombre de variantes"
                />
              </div>
            </div>
            <div className="text-[22px] text-slate-300">=</div>
            <div>
              <div className={label}>Total</div>
              <div className="text-[34px] font-semibold leading-none tabular-nums text-slate-900 dark:text-slate-100">
                {total} <span className="text-[14px] font-medium text-slate-500">créa{total > 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => (planOpen && plan ? setPlanOpen(false) : void loadPlan(false))} disabled={planning || !total} className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-700 hover:underline disabled:opacity-50 dark:text-slate-200">
              {planning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", planOpen && "rotate-180")} />}
              Aperçu du plan
            </button>
            <button type="button" onClick={() => void loadPlan(true)} disabled={planning || !total} className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:underline disabled:opacity-50">
              <RefreshCw className="h-3.5 w-3.5" />
              Régénérer le plan
            </button>
            <span className="text-[11px] text-slate-400">Gratuit : aucune image n&apos;est générée.</span>
          </div>
          {planOpen && plan ? (
            <div className="mt-3 grid gap-4 rounded-2xl bg-slate-50 p-4 text-[12px] dark:bg-slate-800/60 sm:grid-cols-2">
              <div>
                <div className={label}>Mécanismes visuels</div>
                <ul className="space-y-0.5">
                  {plan.families.map((family) => (
                    <li key={family.id} className="flex justify-between gap-2">
                      <span className="text-slate-700 dark:text-slate-200">{family.label}</span>
                      <span className="tabular-nums text-slate-500">× {family.count}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-[11px] text-slate-500">
                  Transformation {plan.groups.transformation} · Détail {plan.groups.feature} · Social {plan.groups.social} · Produit {plan.groups.product}
                </div>
              </div>
              <div>
                <div className={label}>Angles</div>
                <ul className="space-y-0.5">
                  {plan.angles.map((angle) => (
                    <li key={angle.id} className="flex justify-between gap-2">
                      <span className="text-slate-700 dark:text-slate-200">{angle.name}</span>
                      <span className="tabular-nums text-slate-500">× {angle.count}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-[11px] text-slate-500">
                  {plan.layouts} mises en page · {plan.subjects} sujet{plan.subjects > 1 ? "s" : ""} · {plan.hooks} accroches distinctes
                </div>
                {plan.adjustments.length ? <ul className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{plan.adjustments.map((line) => <li key={line}>{line}</li>)}</ul> : null}
              </div>
            </div>
          ) : null}
          <div className="mt-6 max-w-md">{cta}</div>
          <p className="mt-2 text-[11px] text-slate-500">
            V1 change la composition, V2 le modèle ou le décor, V3 le cadrage et l&apos;intensité. Même angle, exécution différente : tu sais pourquoi une créa gagne.
          </p>
        </section>

        {/* ---------------- Options avancées ---------------- */}
        <section>
          <button type="button" onClick={() => setAdvanced((value) => !value)} className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            Options avancées
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", advanced && "rotate-180")} />
          </button>
          {advanced ? (
            <div className="mt-4 grid gap-6 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60 sm:grid-cols-2">
              <div>
                <div className={label}>Créas de référence · jusqu&apos;à 3</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {references.map((reference, index) => (
                    <div key={`${reference.name}-${index}`} className="relative h-12 w-12 overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={reference.dataUrl} alt="" className="h-full w-full object-cover" />
                      <button type="button" onClick={() => setReferences((current) => current.filter((_, i) => i !== index))} className="absolute right-0 top-0 rounded bg-black/60 p-0.5 text-white" aria-label="Retirer">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                  {references.length < 3 ? (
                    <button type="button" onClick={() => fileRef.current?.click()} className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-slate-400 ring-1 ring-dashed ring-slate-300 hover:text-slate-600 dark:bg-slate-900 dark:ring-slate-600" title="Ajouter une créa de référence">
                      <ImagePlus className="h-4 w-4" />
                    </button>
                  ) : null}
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void addReferences(event.target.files)} />
                </div>
                {references.length ? (
                  <div className="mt-3">
                    <div className={label}>Force de la référence</div>
                    <div className="flex items-center gap-1">
                      {STRENGTHS.map((entry) => (
                        <button key={entry.id} type="button" onClick={() => setStrength(entry.id)} title={entry.hint} className={chip(strength === entry.id)}>
                          {entry.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-500">La structure de la référence est reprise, jamais sa marque ni son produit.</p>
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <div className={label}>Format</div>
                  <div className="flex items-center gap-1">
                    {RATIOS.map((item) => (
                      <button key={item.id} type="button" onClick={() => setRatio(item.id)} title={item.hint} className={chip(ratio === item.id)}>
                        {item.id}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className={label}>Taille</div>
                  <div className="flex items-center gap-1">
                    {(["1K", "2K"] as const).map((value) => (
                      <button key={value} type="button" onClick={() => setResolution(value)} className={chip(resolution === value)}>
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">Modèle : GPT Image 2, image vers image quand le produit a des photos.</div>
              </div>
              {digital ? (
                <div>
                  <div className={label}>Représentation du produit digital</div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setPhysicalMockup(false)} className={chip(!physicalMockup)}>
                      Jamais d&apos;objet physique
                    </button>
                    <button type="button" onClick={() => setPhysicalMockup(true)} className={chip(physicalMockup)}>
                      Mockup autorisé
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">Par défaut, un PDF ne devient jamais un livre ou une boîte : il se montre sur un écran, une checklist, un protocole.</p>
                </div>
              ) : null}
              <div>
                <div className={label}>Mix des mécanismes</div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setMixMode("auto")} className={chip(mixMode === "auto")}>
                    Auto
                  </button>
                  <button type="button" onClick={() => setMixMode("custom")} className={chip(mixMode === "custom")}>
                    Personnalisé
                  </button>
                </div>
                {mixMode === "custom" ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                    {(
                      [
                        ["transformation", "Transformation"],
                        ["feature", "Détail / problème"],
                        ["social", "Social / lifestyle"],
                        ["product", "Produit / système"],
                      ] as Array<[FamilyGroup, string]>
                    ).map(([group, name]) => (
                      <label key={group} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                        <span className="text-slate-600 dark:text-slate-300">{name}</span>
                        <input
                          type="number"
                          min={0}
                          value={mix[group]}
                          onChange={(event) => setMix((current) => ({ ...current, [group]: Math.max(0, Number(event.target.value) || 0) }))}
                          className="w-14 rounded-md border border-slate-200 px-1 text-right tabular-nums dark:border-slate-700 dark:bg-slate-950"
                        />
                      </label>
                    ))}
                    <div className="col-span-2 text-slate-500">Total demandé {Object.values(mix).reduce((a, b) => a + b, 0)} · le plan le ramène à {total}.</div>
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-500">Auto répartit selon l&apos;emphase : résultat d&apos;abord = 40 % transformation, 25 % détail, 20 % social, 15 % produit.</p>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {/* ---------------- Résumé collant ---------------- */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]">
          <div className={label}>Ton test</div>
          <dl className="space-y-2 text-[12px]">
            {[
              ["Produit", product.name],
              ["Angles", String(chosenAngles.length)],
              ["Styles", String(chosenPresets.length)],
              ["Variantes / angle", String(variations)],
              ["Emphase", EMPHASES.find((entry) => entry.id === emphasis)?.label ?? ""],
              ["Format", `${ratio} · ${resolution}`],
            ].map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3">
                <dt className="text-slate-500">{key}</dt>
                <dd className="truncate text-right font-medium text-slate-900 dark:text-slate-100">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div className="text-[26px] font-semibold leading-none tabular-nums text-slate-900 dark:text-slate-100">{total}</div>
            <div className="text-[11px] text-slate-500">créa{total > 1 ? "s" : ""} · {total} rendu{total > 1 ? "s" : ""} Kie</div>
          </div>
          <div className="mt-3">{cta}</div>
        </div>
      </aside>

      {/* Mobile : le bouton reste sous la main. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:hidden">{cta}</div>

      {picker === "angles" ? (
        <AnglePicker
          suggested={product.suggestedAngles}
          custom={product.customAngles}
          selected={angleIds}
          onToggle={(id) => setAngleIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))}
          onAddCustom={addCustomAngle}
          onRemoveCustom={removeCustomAngle}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {picker === "styles" ? (
        <StylePicker selected={presetIds} onToggle={(id) => setPresetIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))} onClose={() => setPicker(null)} />
      ) : null}
    </div>
  );
}
