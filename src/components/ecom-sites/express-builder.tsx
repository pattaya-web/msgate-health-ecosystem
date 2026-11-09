"use client";

import { useRef, useState } from "react";
import { Check, ExternalLink, FileText, ImagePlus, Loader2, Rocket, X } from "lucide-react";
import { toast } from "sonner";
import { MAX_PRICE, SUBSCRIPTION_WORDS, type EcomSite } from "@/lib/ecom-sites/types";
import { cn } from "@/lib/utils";

/**
 * La boutique express : un écran, un bouton.
 *
 * Le parcours détaillé demandait une dizaine de gestes dans l'ordre — lire le
 * modèle, cocher, copier, charger la LLC, lancer les packagings, puis les
 * visuels, puis la page « about ». Ici tout part d'un coup : le modèle est
 * copié (produits, prix, mise en page), la LLC, l'email et le téléphone
 * remplissent footer et politiques, et les images de marque s'enchaînent
 * toutes seules. Marché US, achat unique. On retouche ensuite dans l'aperçu.
 */

type Props = {
  /** Ouvre la boutique dans l'éditeur (aperçu modifiable). */
  onOpen: (siteId: string) => Promise<void>;
  /** La liste des boutiques a changé. */
  onListChange: () => Promise<void>;
  /** Un résultat d'image arrive : l'éditeur le pose sur son brouillon si c'est cette boutique. */
  onSiteUpdate: (siteId: string, patch: (site: EcomSite) => Partial<EcomSite>) => void;
};

type Llc = {
  legalName: string;
  stateOfIncorporation: string;
  addressLine: string;
  city: string;
  region: string;
  postalCode: string;
};

const EMPTY_LLC: Llc = { legalName: "", stateOfIncorporation: "", addressLine: "", city: "", region: "", postalCode: "" };

/** Un logo écrit, quand on n'en a pas : net, à la couleur de la marque, prêt en une seconde. */
const WORDMARKS = {
  serif: { label: "Élégant", family: "Georgia, 'Times New Roman', serif", weight: 400, spacing: 0.22, upper: true, dot: false },
  sans: { label: "Fort", family: "'Arial Black', 'Helvetica Neue', Arial, sans-serif", weight: 900, spacing: 0.04, upper: true, dot: false },
  soft: { label: "Doux", family: "'Trebuchet MS', 'Segoe UI', sans-serif", weight: 700, spacing: 0, upper: false, dot: true },
} as const;
type WordmarkStyle = keyof typeof WORDMARKS;

async function renderWordmark(name: string, color: string, style: WordmarkStyle): Promise<string> {
  const spec = WORDMARKS[style];
  const text = spec.upper ? name.toUpperCase() : name.toLowerCase();
  const size = 140;
  const pad = 24;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponible");
  const setup = () => {
    context.font = `${spec.weight} ${size}px ${spec.family}`;
    (context as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${Math.round(spec.spacing * size)}px`;
  };
  setup();
  const textWidth = Math.ceil(context.measureText(text).width);
  const dot = spec.dot ? Math.round(size * 0.16) : 0;
  canvas.width = textWidth + pad * 2 + (dot ? dot * 3 : 0);
  canvas.height = Math.round(size * 1.35);
  setup();
  context.fillStyle = color;
  context.textBaseline = "middle";
  context.fillText(text, pad, canvas.height / 2);
  if (dot) {
    context.beginPath();
    context.arc(pad + textWidth + dot * 1.6, canvas.height / 2 + size * 0.28, dot, 0, Math.PI * 2);
    context.fill();
  }
  return canvas.toDataURL("image/png");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
  return json;
}

async function patchSite(siteId: string, patch: Partial<EcomSite>) {
  const res = await fetch(`/api/ecom-sites/${siteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  const json = (await res.json().catch(() => ({}))) as { site?: EcomSite; error?: string };
  if (!res.ok || !json.site) throw new Error(json.error || "Enregistrement impossible");
  return json.site;
}

async function readSite(siteId: string) {
  const res = await fetch(`/api/ecom-sites/${siteId}`);
  const json = (await res.json()) as { site?: EcomSite };
  return json.site ?? null;
}

function dataUrlOf(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.readAsDataURL(file);
  });
}

/**
 * Une photo de document, réduite à 2000 px de côté en JPEG : un scan de
 * téléphone pèse 5 à 10 Mo, la vision n'a pas besoin de plus pour lire.
 */
async function shrinkImage(file: File) {
  const url = await dataUrlOf(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("image illisible"));
      element.src = url;
    });
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return url;
  }
}

/** Un document de LLC tel que la route le lit : PDF, image (scan, photo, capture) ou texte. */
export async function llcDoc(file: File) {
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") return { fileName: file.name, pdfBase64: await dataUrlOf(file) };
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|gif)$/i.test(file.name)) return { fileName: file.name, imageBase64: await shrinkImage(file) };
  return { fileName: file.name, text: await file.text() };
}

/** Le descripteur bancaire : 22 caractères, lettres et chiffres. */
function descriptorOf(brand: string) {
  return brand.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 22);
}

type Run = {
  siteId: string;
  brand: string;
  slug: string;
  step: string;
  packs: { done: number; total: number } | null;
  media: { done: number; total: number } | null;
  about: "running" | "done" | "fail";
  finished: boolean;
};

const field =
  "h-8 w-full rounded-lg bg-white px-2.5 text-[12px] text-slate-900 ring-1 ring-slate-900/10 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/30 dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10";

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function ExpressBuilder({ onOpen, onListChange, onSiteUpdate }: Props) {
  const [url, setUrl] = useState("");
  const [brand, setBrand] = useState("");
  const [maxProducts, setMaxProducts] = useState(12);
  const [primary, setPrimary] = useState("#1f2937");
  const [secondary, setSecondary] = useState("#f3f4f6");
  const [logo, setLogo] = useState("");
  const [style, setStyle] = useState<WordmarkStyle>("serif");
  const [llc, setLlc] = useState<Llc>(EMPTY_LLC);
  const [llcNote, setLlcNote] = useState("");
  const [llcBusy, setLlcBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [domain, setDomain] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const docInput = useRef<HTMLInputElement>(null);

  const patchRun = (siteId: string, patch: Partial<Run>) =>
    setRuns((current) => current.map((run) => (run.siteId === siteId ? { ...run, ...patch } : run)));

  /** Les statuts et documents de la LLC : raison sociale, État, adresse. Jamais de valeur devinée. */
  async function readLlc(files: FileList | null) {
    const list = files ? [...files] : [];
    if (!list.length) return;
    setLlcBusy(true);
    setLlcNote("");
    try {
      const docs = await Promise.all(list.map(llcDoc));
      const body = await postJson<{ entity: Llc & { supportEmail?: string; supportPhone?: string; missing?: string[] }; files?: Array<{ fileName: string; hint?: string }> }>(
        "/api/ecom-sites/llc",
        { docs }
      );
      const entity = body.entity;
      setLlc((current) => {
        const next = { ...current };
        for (const key of Object.keys(EMPTY_LLC) as Array<keyof Llc>) if (entity[key]) next[key] = entity[key];
        return next;
      });
      if (entity.supportEmail && !email) setEmail(entity.supportEmail);
      if (entity.supportPhone && !phone) setPhone(entity.supportPhone);
      const hints = (body.files ?? []).map((file) => file.hint).filter(Boolean);
      setLlcNote(
        [entity.missing?.length ? `Pas trouvé dans les documents : ${entity.missing.join(", ")}.` : "Documents lus.", ...hints].join(" ")
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Documents illisibles");
    } finally {
      setLlcBusy(false);
      if (docInput.current) docInput.current.value = "";
    }
  }

  /**
   * Les images de marque, toutes seules après la copie : packagings au logo,
   * puis bannière, catégories et scènes avec le pack dedans, et la page
   * « about ». Chaque image est enregistrée dès qu'elle sort.
   */
  async function runImages(siteId: string) {
    const deadline = Date.now() + 12 * 60_000;

    const about = (async () => {
      try {
        const body = await postJson<{ story?: EcomSite["aboutStory"]; taskId?: string | null }>("/api/ecom-sites/about", { action: "generate", siteId });
        if (body.story) onSiteUpdate(siteId, () => ({ aboutStory: body.story }));
        let taskId = body.taskId ?? null;
        while (taskId && Date.now() < deadline) {
          await sleep(5000);
          const status = await postJson<{ state?: string; urls?: string[] }>("/api/ecom-sites/about", { action: "status", taskId });
          if (status.urls?.length) {
            const aboutImageUrl = status.urls[0];
            await patchSite(siteId, { aboutImageUrl, aboutTaskId: null });
            onSiteUpdate(siteId, () => ({ aboutImageUrl, aboutTaskId: null }));
            taskId = null;
          } else if (status.state === "fail") throw new Error("photo about");
        }
        patchRun(siteId, { about: "done" });
      } catch {
        patchRun(siteId, { about: "fail" });
      }
    })();

    let firstPack = "";
    try {
      patchRun(siteId, { step: "Packagings à ta marque" });
      const launched = await postJson<{ jobs: Array<{ handle: string; taskId: string | null }> }>("/api/ecom-sites/packaging", { action: "generate", siteId });
      const pending = new Map(launched.jobs.filter((job) => job.taskId).map((job) => [job.taskId as string, job.handle]));
      const total = pending.size;
      patchRun(siteId, { packs: { done: 0, total } });
      while (pending.size && Date.now() < deadline) {
        await sleep(5000);
        const status = await postJson<{ results?: Array<{ taskId: string; urls?: string[]; state?: string }> }>("/api/ecom-sites/packaging", { action: "status", taskIds: [...pending.keys()] });
        const ready: Array<{ handle: string; url: string }> = [];
        for (const result of status.results ?? []) {
          const handle = pending.get(result.taskId);
          if (!handle) continue;
          if (result.urls?.length) {
            ready.push({ handle, url: result.urls[0] });
            pending.delete(result.taskId);
          } else if (result.state === "fail") pending.delete(result.taskId);
        }
        if (ready.length) {
          if (!firstPack) firstPack = ready[0].url;
          await postJson("/api/ecom-sites/packaging", { action: "attach", siteId, ready });
          const byHandle = new Map(ready.map((item) => [item.handle, item.url]));
          onSiteUpdate(siteId, (site) => ({
            products: site.products.map((product) =>
              byHandle.has(product.handle) ? { ...product, imageUrl: byHandle.get(product.handle)!, packagingTaskId: null } : product
            ),
          }));
        }
        patchRun(siteId, { packs: { done: total - pending.size, total } });
      }
    } catch (error) {
      toast.error(`Packagings : ${error instanceof Error ? error.message : "échec"}`);
    }

    try {
      patchRun(siteId, { step: "Bannière, catégories et scènes" });
      const launched = await postJson<{ jobs: Array<{ key: string; taskId: string | null }> }>("/api/ecom-sites/media", { action: "generate", siteId, packUrl: firstPack || undefined });
      const pending = new Map(launched.jobs.filter((job) => job.taskId).map((job) => [job.taskId as string, job.key]));
      const total = pending.size;
      patchRun(siteId, { media: { done: 0, total } });
      while (pending.size && Date.now() < deadline) {
        await sleep(5000);
        const status = await postJson<{ results?: Array<{ taskId: string; urls?: string[]; state?: string }> }>("/api/ecom-sites/media", { action: "status", taskIds: [...pending.keys()] });
        const ready: Array<{ key: string; url: string }> = [];
        for (const result of status.results ?? []) {
          const key = pending.get(result.taskId);
          if (!key) continue;
          if (result.urls?.length) {
            ready.push({ key, url: result.urls[0] });
            pending.delete(result.taskId);
          } else if (result.state === "fail") pending.delete(result.taskId);
        }
        if (ready.length) {
          // Chaque visuel à sa place : bannière, scène n°, image de catégorie.
          const place = (site: EcomSite): Partial<EcomSite> => {
            let heroImageUrl = site.heroImageUrl;
            const lifestyleUrls = [...(site.lifestyleUrls ?? [])];
            let categories = site.categories;
            for (const item of ready) {
              if (item.key === "hero") heroImageUrl = item.url;
              else if (item.key.startsWith("lifestyle:")) lifestyleUrls[Number(item.key.slice(10)) || 0] = item.url;
              else if (item.key.startsWith("category:")) {
                const id = item.key.slice(9);
                categories = categories.map((category) => (category.id === id ? { ...category, imageUrl: item.url } : category));
              }
            }
            return { heroImageUrl, lifestyleUrls: lifestyleUrls.filter(Boolean), categories };
          };
          const stored = await readSite(siteId);
          if (stored) await patchSite(siteId, place(stored));
          onSiteUpdate(siteId, place);
        }
        patchRun(siteId, { media: { done: total - pending.size, total } });
      }
    } catch (error) {
      toast.error(`Visuels : ${error instanceof Error ? error.message : "échec"}`);
    }

    await about;
    patchRun(siteId, { step: "Prête", finished: true });
    toast.success("Boutique prête : images de marque posées");
  }

  async function create() {
    const model = url.trim();
    const name = brand.trim();
    if (!model) return toast.error("Colle le site modèle");
    if (!name) return toast.error("Donne un nom à la marque");
    if (!email.trim() || !phone.trim()) return toast.error("Email pro et téléphone : le processeur vérifie qu'ils répondent");
    setCreating("Lecture du site modèle");
    try {
      const read = await postJson<{ products: Array<{ handle: string; name: string; price: number }> }>("/api/ecom-sites/reference", { action: "read", domain: model });
      const usable = (read.products ?? []).filter((product) => !SUBSCRIPTION_WORDS.test(product.name));
      if (!usable.length) throw new Error("Aucun produit lisible sur ce site");
      const handles = usable.slice(0, maxProducts).map((product) => product.handle);

      setCreating(`${handles.length} produits — copie et textes de marque`);
      const logoDataUrl = logo || (await renderWordmark(name, primary, style));
      const cloned = await postJson<{ site: EcomSite; warnings?: string[] }>("/api/ecom-sites/clone", {
        domain: model,
        brandName: name,
        themeId: "mono",
        logoDataUrl,
        brandColors: { primary, secondary },
        handles,
      });

      setCreating("LLC, contact et domaine");
      const site = await patchSite(cloned.site.id, {
        ...Object.fromEntries(Object.entries(llc).filter(([, value]) => value.trim())),
        country: "United States",
        supportEmail: email.trim(),
        supportPhone: phone.trim(),
        billingDescriptor: descriptorOf(name),
        currency: "USD",
        shipsFrom: "United States",
        domain: domain.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""),
      });

      await onListChange();
      await onOpen(site.id);
      setRuns((current) => [
        { siteId: site.id, brand: name, slug: site.slug, step: "Images en cours", packs: null, media: null, about: "running", finished: false },
        ...current,
      ]);
      toast.success(`${name} créée — ${site.products.length} produits, images en route (≈ 3 min)`);
      if (cloned.warnings?.length) toast.warning(cloned.warnings.join(" "));

      // Prochaine boutique : on garde les couleurs, le reste repart à zéro.
      setUrl("");
      setBrand("");
      setLogo("");
      setDomain("");
      void runImages(site.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Création impossible");
    } finally {
      setCreating(null);
    }
  }

  const spec = WORDMARKS[style];
  const llcFilled = Object.values(llc).filter((value) => value.trim()).length;

  return (
    <div className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[13px] font-semibold">Nouvelle boutique express</h3>
        <span className="text-[11px] text-slate-500">
          Marché US · achat unique · prix du modèle (max ${MAX_PRICE}) · politiques, footer LLC et contact remplis · packagings et visuels à ta marque
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px]">
        <Field label="1 · Site modèle">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://site-exemple.com" className={field} autoFocus />
        </Field>
        <Field label="2 · Nouveau nom">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Nom de la marque" className={field} />
        </Field>
        <Field label="Produits max">
          <select value={maxProducts} onChange={(e) => setMaxProducts(Number(e.target.value))} className={field}>
            {[6, 8, 12, 20, 40].map((count) => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Logo : le sien, ou un logo écrit à la couleur de la marque. */}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="3 · Logo">
          <div className="flex items-center gap-1.5">
            {(Object.keys(WORDMARKS) as WordmarkStyle[]).map((key) => {
              const item = WORDMARKS[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setStyle(key);
                    setLogo("");
                  }}
                  title={`Logo écrit · ${item.label}`}
                  className={cn(
                    "flex h-10 max-w-[170px] items-center overflow-hidden rounded-lg bg-white px-2.5 ring-1",
                    !logo && style === key ? "ring-2 ring-emerald-500" : "ring-slate-900/10 dark:ring-white/10"
                  )}
                >
                  <span
                    className="truncate text-[15px] leading-none"
                    style={{ fontFamily: item.family, fontWeight: item.weight, letterSpacing: `${item.spacing}em`, color: primary }}
                  >
                    {(item.upper ? (brand || "Brand").toUpperCase() : (brand || "brand").toLowerCase()) + (item.dot ? "." : "")}
                  </span>
                </button>
              );
            })}
            <label
              className={cn(
                "flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 text-[11px] font-semibold ring-1 dark:bg-slate-800",
                logo ? "ring-2 ring-emerald-500" : "ring-slate-900/10 dark:ring-white/10"
              )}
              title="Ton propre logo (PNG ou JPG)"
            >
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="h-6 w-auto max-w-[90px] object-contain" />
              ) : (
                <ImagePlus className="h-3.5 w-3.5" />
              )}
              {logo ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : "Mon logo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => setLogo(String(reader.result || ""));
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          </div>
        </Field>
        <Field label="Couleurs">
          <div className="flex h-10 items-center gap-1.5">
            <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} title="Couleur principale" className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent p-0" />
            <input type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} title="Couleur de fond douce" className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent p-0" />
          </div>
        </Field>
        {!logo ? (
          <span className="pb-3 text-[11px] text-slate-400">
            Logo écrit « {spec.label} » à la couleur principale — ou charge le tien.
          </span>
        ) : null}
      </div>

      {/* La LLC : on dépose les documents, les champs se remplissent. */}
      <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/50">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">4 · Documents LLC</span>
          <button
            type="button"
            onClick={() => docInput.current?.click()}
            disabled={llcBusy}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 text-[11px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {llcBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            {llcBusy ? "Lecture…" : "Déposer les docs de la LLC"}
          </button>
          <input ref={docInput} type="file" multiple accept=".pdf,.txt,application/pdf,text/plain,image/*" className="hidden" onChange={(event) => void readLlc(event.target.files)} />
          <span className="text-[11px] text-slate-400">
            {llcNote || "Articles, EIN, statuts : raison sociale, État et adresse se remplissent seuls (PDF, même scanné, photo ou capture)."}
          </span>
          {llcFilled ? (
            <button type="button" onClick={() => { setLlc(EMPTY_LLC); setLlcNote(""); }} className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-600">
              <X className="h-3 w-3" />
              Vider
            </button>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Raison sociale" className="sm:col-span-2">
            <input value={llc.legalName} onChange={(e) => setLlc({ ...llc, legalName: e.target.value })} placeholder="BRAND HOLDINGS LLC" className={field} />
          </Field>
          <Field label="État de la LLC">
            <input value={llc.stateOfIncorporation} onChange={(e) => setLlc({ ...llc, stateOfIncorporation: e.target.value })} placeholder="Wyoming" className={field} />
          </Field>
          <Field label="Adresse" className="sm:col-span-3 lg:col-span-3">
            <input value={llc.addressLine} onChange={(e) => setLlc({ ...llc, addressLine: e.target.value })} placeholder="30 N Gould St Ste R" className={field} />
          </Field>
          <Field label="Ville">
            <input value={llc.city} onChange={(e) => setLlc({ ...llc, city: e.target.value })} placeholder="Sheridan" className={field} />
          </Field>
          <Field label="État (adresse)">
            <input value={llc.region} onChange={(e) => setLlc({ ...llc, region: e.target.value })} placeholder="WY" className={field} />
          </Field>
          <Field label="Code postal">
            <input value={llc.postalCode} onChange={(e) => setLlc({ ...llc, postalCode: e.target.value })} placeholder="82801" className={field} />
          </Field>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="5 · Email pro">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="support@marque.com" className={field} type="email" />
        </Field>
        <Field label="Téléphone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (307) 555-0123" className={field} />
        </Field>
        <Field label="Domaine (plus tard, optionnel)">
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="marque.com" className={field} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void create()}
          disabled={Boolean(creating)}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-[13px] font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          {creating ? creating : "Créer la boutique"}
        </button>
        <span className="text-[11px] text-slate-400">
          ≈ 1 min pour la boutique, puis ≈ 3 min d&apos;images en tâche de fond : tu peux lancer la suivante, garde juste l&apos;onglet ouvert.
        </span>
      </div>

      {runs.length ? (
        <div className="space-y-1.5">
          {runs.map((run) => (
            <div key={run.siteId} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12px] dark:bg-slate-800/60">
              {run.finished ? <Check className="h-4 w-4 text-emerald-600" /> : <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              <span className="font-semibold">{run.brand}</span>
              <span className="text-slate-500">{run.step}</span>
              {run.packs ? <span className="text-[11px] text-slate-400">packagings {run.packs.done}/{run.packs.total}</span> : null}
              {run.media ? <span className="text-[11px] text-slate-400">visuels {run.media.done}/{run.media.total}</span> : null}
              <span className="text-[11px] text-slate-400">about {run.about === "running" ? "…" : run.about === "done" ? "✓" : "✗"}</span>
              <div className="ml-auto flex gap-1.5">
                <button type="button" onClick={() => void onOpen(run.siteId)} className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold ring-1 ring-slate-900/10 dark:bg-slate-900">
                  Ouvrir l&apos;éditeur
                </button>
                <a href={`/s/${run.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold ring-1 ring-slate-900/10 dark:bg-slate-900">
                  <ExternalLink className="h-3 w-3" />
                  Voir
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
