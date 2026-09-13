"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, FileText, ImagePlus, Loader2, Monitor, Plus, Sparkles, Trash2, TriangleAlert, X, Zap } from "lucide-react";
import { toast } from "sonner";
import type { CheckItem, CheckStatus } from "@/lib/ecom-sites/checklist";
import type { ReferenceProduct as RefProduct } from "@/lib/ecom-sites/reference";
import type { ReferenceSite } from "@/lib/ecom-sites/reference-store";
import {
  ECOM_THEMES,
  PRICE_POINTS,
  ecomTheme,
  type EcomFooter,
  type EcomSection,
  type EcomPage,
  type EcomSite,
  type EcomThemeId,
} from "@/lib/ecom-sites/types";
import { ImagePromptDialog, type ImageTarget } from "@/components/ecom-sites/image-prompt";
import { LivePreview } from "@/components/ecom-sites/live-preview";
import { MessagesInbox } from "@/components/ecom-sites/messages-inbox";
import { assuranceItems, BLOCK_LABELS, newSectionId, sectionsOf } from "@/lib/ecom-sites/sections";
import { blankPage, navItems } from "@/lib/ecom-sites/pages";
import { applyTextEdit } from "@/lib/ecom-sites/text-edits";
import {
  defaultCopyright,
  defaultLegalLine,
  footerColumns,
  footerPayments,
  type FooterColumn,
} from "@/lib/ecom-sites/footer";
import { cn } from "@/lib/utils";

/** Enregistrements Vercel — ceux que pointent déjà les sites existants. */
const APEX_IP = "216.198.79.1";
const WWW_CNAME = "cname.vercel-dns.com";

type Score = { total: number; ok: number; warns: number; fails: number; ready: boolean };

const field =
  "h-8 w-full rounded-lg bg-slate-50 px-2.5 text-[12px] text-slate-900 outline-none focus:ring-1 focus:ring-emerald-400 dark:bg-slate-800 dark:text-slate-100";
const area =
  "w-full rounded-lg bg-slate-50 px-2.5 py-2 text-[12px] text-slate-900 outline-none focus:ring-1 focus:ring-emerald-400 dark:bg-slate-800 dark:text-slate-100";
const label = "text-[10px] font-semibold uppercase tracking-wide text-slate-400";

function Labelled({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className={label}>{text}</span>
      {children}
    </label>
  );
}

const STATUS_STYLE: Record<CheckStatus, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  fail: "text-rose-600 dark:text-rose-400",
};

export function EcomSitesTab() {
  const [sites, setSites] = useState<EcomSite[]>([]);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EcomSite | null>(null);
  const [checklist, setChecklist] = useState<CheckItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [newBrand, setNewBrand] = useState("");
  const [cloneOf, setCloneOf] = useState("");
  const [niche, setNiche] = useState("");
  /** Pages ajoutées : l'adresse à reprendre, le titre d'une page vide, la page à ouvrir dans l'aperçu. */
  const [pageUrl, setPageUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [openPath, setOpenPath] = useState<{ path: string; nonce: number } | null>(null);
  /** Sert au seul cas d'un site créé de zéro, sans catalogue à reprendre. */
  const productCount = 8;
  const pollRef = useRef<number | null>(null);
  /** Packaging ouvert en grand, pour le juger avant de valider le site. */
  const [zoomPack, setZoomPack] = useState<string | null>(null);
  const mediaPollRef = useRef<number | null>(null);
  /** Visuels encore en génération, pour l'afficher. */
  const [mediaLeft, setMediaLeft] = useState(0);
  /**
   * Visuels sortis du modèle, en attente de ton avis.
   *
   * Ils ne se posent plus d'eux-mêmes sur le site : une bannière ratée
   * remplaçait silencieusement une bonne, et il fallait relancer toute la
   * fournée pour revenir en arrière. Ils s'accumulent ici, tu gardes ou tu
   * jettes, image par image.
   */
  const [mediaProposals, setMediaProposals] = useState<Array<{ key: string; url: string }>>([]);
  /**
   * Avancement des fournées en cours, et depuis combien de temps.
   *
   * Une génération dure deux minutes : sans compteur ni chrono, on ne sait pas
   * si ça avance ou si c'est bloqué, et on reclique. Le total est figé au
   * lancement — le nombre de produits du site ne le donne pas quand on n'en a
   * sélectionné qu'une partie.
   */
  const [packRun, setPackRun] = useState<{ done: number; total: number } | null>(null);
  const [mediaRun, setMediaRun] = useState<{ done: number; total: number } | null>(null);
  const [runSeconds, setRunSeconds] = useState(0);
  /** Photo de la page « à propos » en cours de fabrication. */
  const [aboutRunning, setAboutRunning] = useState(false);
  /**
   * L'aperçu vivant, et l'état du brouillon.
   *
   * `saved` garde la version telle qu'elle est sur le serveur : la comparer au
   * brouillon dit s'il reste quelque chose à enregistrer. Sans ce repère, le
   * bandeau de l'aperçu ne saurait pas quoi annoncer, et on publierait en
   * croyant avoir sauvé.
   */
  const [showPreview, setShowPreview] = useState(true);
  /** La section désignée dans l'aperçu, dont on règle les options. */
  const [picked, setPicked] = useState<string | null>(null);
  /** Glisser-deposer : la ligne prise, et celle survolee. */
  /** La colonne de pied de page dont l'IA est en train d'ecrire le texte. */
  const [footerBusy, setFooterBusy] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  /** Les sections dont les réglages sont dépliés : par défaut tout est replié, l'aperçu les ouvre. */
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const isSectionOpen = (id: string) => openSections.has(id) || picked === id;
  const toggleSection = (id: string) =>
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id) || picked === id) {
        next.delete(id);
        if (picked === id) setPicked(null);
      } else next.add(id);
      return next;
    });
  const [dragOver, setDragOver] = useState<number | null>(null);
  /**
   * L'image qu'on est en train de refaire, et où la ranger.
   *
   * Une seule fenêtre sert tous les emplacements — bannière, catégorie,
   * ambiance, bloc libre, packaging. Elle ne sait rien d'eux : elle reçoit
   * l'image de départ et la fonction qui range le résultat.
   */
  const [imageTarget, setImageTarget] = useState<ImageTarget | null>(null);
  const [saved, setSaved] = useState("");
  const aboutPollRef = useRef<number | null>(null);
  const clockRef = useRef<number | null>(null);
  /** Étape de la copie en cours, et depuis combien de temps elle dure. */
  const [copyStep, setCopyStep] = useState<{ label: string; done: number } | null>(null);
  const [copySeconds, setCopySeconds] = useState(0);
  /** Domaine à piller pour compléter le catalogue d'un site déjà créé. */
  const [addFrom, setAddFrom] = useState("");
  /** Une de tes boutiques dont on reprend des produits. */
  const [addFromSite, setAddFromSite] = useState("");
  /** Produits cochés : les actions ne portent que sur eux quand il y en a. */
  const [pickedProducts, setPickedProducts] = useState<string[]>([]);
  const [pickFilter, setPickFilter] = useState("");

  /* Modèles : les boutiques déjà en ligne servent de gabarit de catalogue. */
  const [references, setReferences] = useState<ReferenceSite[]>([]);
  const [newReference, setNewReference] = useState("");
  const [copyBrand, setCopyBrand] = useState("");
  const [copyTheme, setCopyTheme] = useState<EcomThemeId>("glow");
  /* Identité de la copie, posée avant de lancer : logo, deux couleurs, tri. */
  const [copyLogo, setCopyLogo] = useState("");
  const [copyPrimary, setCopyPrimary] = useState("#d9548a");
  const [copySecondary, setCopySecondary] = useState("#fdeef4");
  /** Produits retenus dans l'aperçu. Vide = tout le catalogue. */
  const [copyPicks, setCopyPicks] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ domain: string; products: RefProduct[] } | null>(null);

  /* Dépôt des statuts de la LLC : pré-remplissage, jamais de valeur devinée. */
  const [dropping, setDropping] = useState(false);
  const [llcNote, setLlcNote] = useState("");
  const [llcFiles, setLlcFiles] = useState<
    Array<{ fileName: string; chars: number; reason: string; hint?: string }>
  >([]);

  async function readLlcDocument(files: FileList | File[] | null | undefined) {
    const list = files ? [...files] : [];
    if (!list.length || !draft) return;
    setBusy("llc");
    setLlcNote("");
    setLlcFiles([]);
    try {
      // Tout le dossier part en une requête : les champs se cumulent entre
      // pièces, aucune ne les porte toutes.
      const docs = await Promise.all(
        list.map(async (file) => {
          const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
          if (!isPdf) return { fileName: file.name, text: await file.text() };
          const pdfBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
            reader.readAsDataURL(file);
          });
          return { fileName: file.name, pdfBase64 };
        })
      );

      const res = await fetch("/api/ecom-sites/llc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docs }),
      });
      const body = await res.json();
      // Même en échec, le détail par fichier dit lequel a coincé et pourquoi.
      if (body.files) setLlcFiles(body.files);
      if (!res.ok) throw new Error(body.error);

      const entity = body.entity as Record<string, string> & { missing: string[] };
      // Seuls les champs réellement trouvés écrasent la saisie en cours.
      const patch: Partial<EcomSite> = {};
      for (const key of [
        "legalName",
        "stateOfIncorporation",
        "addressLine",
        "city",
        "region",
        "postalCode",
        "country",
        "supportEmail",
        "supportPhone",
      ] as const) {
        if (entity[key]) patch[key] = entity[key];
      }
      patchDraft(patch);

      const filled = Object.keys(patch).length;
      toast.success(`${filled} champ(s) remplis depuis ${list.length} document(s)`);
      if (entity.missing?.length) {
        setLlcNote(`Non trouvé dans le document, à saisir à la main : ${entity.missing.join(", ")}.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Document illisible");
    } finally {
      setBusy(null);
    }
  }

  const loadReferences = useCallback(async () => {
    const res = await fetch("/api/ecom-sites/reference");
    const body = await res.json();
    setReferences(body.references || []);
  }, []);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/ecom-sites");
    const body = await res.json();
    setSites(body.sites || []);
    setScores(body.scores || {});
    setLoading(false);
  }, []);

  const loadSite = useCallback(async (id: string) => {
    const res = await fetch(`/api/ecom-sites/${id}`);
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.error || "Site introuvable");
      return;
    }
    setDraft(body.site);
    // Repere de comparaison : ce que le serveur a, avant toute retouche.
    setSaved(JSON.stringify(body.site));
    setChecklist(body.checklist || []);
    setSelectedId(id);
  }, []);

  useEffect(() => {
    void loadList();
    void loadReferences();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [loadList, loadReferences]);

  async function addReference() {
    if (!newReference.trim()) return;
    try {
      const res = await fetch("/api/ecom-sites/reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", domain: newReference }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNewReference("");
      await loadReferences();
      toast.success(`${body.reference.domain} ajouté aux modèles`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ajout impossible");
    }
  }

  async function removeReference(domain: string) {
    await fetch(`/api/ecom-sites/reference?domain=${encodeURIComponent(domain)}`, { method: "DELETE" });
    if (preview?.domain === domain) setPreview(null);
    await loadReferences();
  }

  /** Aperçu du catalogue source avant de lancer une copie. */
  async function readReference(domain: string) {
    setBusy(`read:${domain}`);
    try {
      const res = await fetch("/api/ecom-sites/reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", domain }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      /*
       * Changer de modèle vide la sélection.
       *
       * Les cases cochées désignent des produits d'un catalogue précis. Gardées
       * en changeant de site, elles ne correspondent plus à rien : le filtre de
       * la copie écartait alors tout, et la boutique naissait vide sans qu'un
       * message ne le dise.
       */
      setPreview((current) => {
        if (current?.domain !== domain) setCopyPicks([]);
        return { domain, products: body.products || [] };
      });
      await loadReferences();
      if (body.warnings?.length) toast.warning(body.warnings.join(" "));
      toast.success(`${body.products.length} produits lus sur ${domain}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lecture impossible");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Copie fidèle du site modèle, en étapes visibles.
   *
   * La lecture est faite à part avant la copie, alors que la copie la referait
   * elle-même : quelques secondes de plus, en échange d'un vrai décompte de
   * produits à afficher. Une barre qui avance sur une étape connue vaut mieux
   * qu'une roue qui tourne une minute sans rien dire.
   */
  async function copyReference(domain: string, fast = false) {
    if (!copyBrand.trim()) {
      toast.error("Donne un nom de marque à la copie");
      return;
    }
    setBusy(`copy:${domain}`);
    // Un simple incrément : lire l'horloge ici est vu comme un effet de bord.
    setCopySeconds(0);
    const tick = window.setInterval(() => setCopySeconds((value) => value + 1), 1000);

    try {
      setCopyStep({ label: `Lecture de ${domain}`, done: 0 });
      const readRes = await fetch("/api/ecom-sites/reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", domain }),
      });
      const read = await readRes.json();
      if (!readRes.ok) throw new Error(read.error);
      const count = (read.products || []).length;

      setCopyStep({
        label: fast ? `${count} produits lus — copie directe` : `${count} produits lus — réécriture des textes`,
        done: 1,
      });
      const res = await fetch("/api/ecom-sites/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          brandName: copyBrand,
          themeId: copyTheme,
          logoDataUrl: copyLogo || undefined,
          brandColors: { primary: copyPrimary, secondary: copySecondary },
          // Une sélection faite dans l'aperçu restreint la copie — mais elle ne
          // vaut que pour le catalogue où elle a été faite.
          handles:
            preview?.domain === domain && copyPicks.length ? copyPicks : undefined,
          // Copie éclair : aucun appel au modèle de langage.
          fast,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);

      setCopyStep({ label: "Création du site", done: 2 });
      setCopyBrand("");
      await loadList();
      await loadSite(body.site.id);
      toast.success(
        `${body.site.brandName} créé depuis ${body.copiedFrom} — ${body.site.products.length} produits repris`
      );
      // Un repli de textes doit se voir : sinon on croit la réécriture faite.
      if (body.warnings?.length) toast.warning(body.warnings.join(" "));

      setCopyPicks([]);

      /*
       * Les visuels attendent les packagings, sans exception.
       *
       * Ils partaient dès la copie « pour habiller le site en attendant ». Sans
       * un seul pack à montrer, le modèle d'image comblait la scène avec des
       * flacons inventés, sans marque : des visuels payés, à jeter, et pris
       * pour le résultat final. Une seule chaîne désormais — packagings, puis
       * scènes — déclenchée à la fin de la fournée dans `startPolling`.
       */
      if (copyLogo) await generatePackaging();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Copie impossible");
    } finally {
      window.clearInterval(tick);
      setCopyStep(null);
      setCopySeconds(0);
      setBusy(null);
    }
  }

  /**
   * Visuels d'ambiance du site : bannière, une image par catégorie, deux scènes.
   *
   * Générés, jamais repris du site modèle — c'est la seule partie de la copie
   * qui doit être à nous. Le suivi passe par les mêmes taskId que le packaging,
   * ce qui permet de retrouver une génération après un rechargement.
   */
  async function generateMedia(siteId: string, packUrl?: string) {
    setBusy("media");
    try {
      /*
       * Le pack brandé voyage avec la demande.
       *
       * La route le cherchait dans le site stocké, mais un packaging qui vient
       * de sortir n'y est pas encore : il est dans le brouillon, tant que tu
       * n'as pas enregistré. Les scènes repartaient donc sans produit, juste
       * après la fournée de packagings — le moment précis où elles en avaient
       * un à montrer.
       */
      const pack =
        packUrl ||
        draft?.products.find(
          (product) => product.imageUrl && product.imageUrl !== product.sourceImageUrl
        )?.imageUrl;

      const res = await fetch("/api/ecom-sites/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", siteId, packUrl: pack || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);

      const jobs = (body.jobs || []).filter((job: { taskId?: string }) => job.taskId);
      if (!jobs.length) throw new Error("Aucun visuel lancé");
      toast.success(`${jobs.length} visuels en génération`);
      setMediaRun({ done: 0, total: jobs.length });
      startClock();
      startMediaPolling(siteId, jobs);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Visuels impossibles");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Récit de marque et sa photo d'atelier.
   *
   * Le texte revient tout de suite, l'image se fait attendre : on pose l'un
   * sans attendre l'autre, et l'image se range quand elle arrive.
   */
  async function generateAbout() {
    if (!draft) return;
    setBusy("about");
    try {
      const res = await fetch("/api/ecom-sites/about", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", siteId: draft.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);

      setDraft((current) => (current ? { ...current, aboutStory: body.story } : current));
      toast.success(
        body.written ? "Histoire de marque écrite" : "Histoire de repli posée — relance pour la faire réécrire"
      );
      if (body.imageError) toast.error(body.imageError);
      if (body.taskId) {
        setAboutRunning(true);
        pollAbout(draft.id, body.taskId);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Histoire impossible");
    } finally {
      setBusy(null);
    }
  }

  /** Attend la photo d'atelier et la range sur le brouillon. */
  function pollAbout(siteId: string, taskId: string) {
    if (aboutPollRef.current) window.clearInterval(aboutPollRef.current);
    aboutPollRef.current = window.setInterval(async () => {
      const res = await fetch("/api/ecom-sites/about", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", taskId }),
      });
      const body = await res.json();
      if (body.urls?.length) {
        setDraft((current) =>
          current && current.id === siteId
            ? { ...current, aboutImageUrl: body.urls[0], aboutTaskId: null }
            : current
        );
        /*
         * Elle est enregistrée tout de suite, comme les packagings.
         *
         * Le brouillon suffisait tant qu'on restait sur la page ; fermer
         * l'onglet avant de sauvegarder perdait une image déjà facturée. Un
         * seul champ part au serveur, donc la saisie en cours n'est pas touchée.
         */
        void fetch(`/api/ecom-sites/${siteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aboutImageUrl: body.urls[0], aboutTaskId: null }),
        }).catch(() => {});
        toast.success("Photo de la page « à propos » prête");
      } else if (body.state !== "fail") {
        return;
      } else {
        toast.error(body.failMsg || "Photo impossible");
      }
      if (aboutPollRef.current) window.clearInterval(aboutPollRef.current);
      setAboutRunning(false);
    }, 4000);
  }

  /** Range chaque visuel à sa place dès qu'il sort. */
  function startMediaPolling(siteId: string, jobs: Array<{ key: string; taskId: string }>) {
    if (mediaPollRef.current) window.clearInterval(mediaPollRef.current);
    const pending = new Map(jobs.map((job) => [job.taskId, job.key]));

    mediaPollRef.current = window.setInterval(async () => {
      if (!pending.size) {
        if (mediaPollRef.current) window.clearInterval(mediaPollRef.current);
        return;
      }
      const res = await fetch("/api/ecom-sites/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", taskIds: [...pending.keys()] }),
      });
      const body = await res.json();
      const ready: Array<{ key: string; url: string }> = [];

      for (const result of body.results || []) {
        const key = pending.get(result.taskId);
        if (!key) continue;
        if (result.urls?.length) {
          ready.push({ key, url: result.urls[0] });
          pending.delete(result.taskId);
        } else if (result.state === "fail") {
          pending.delete(result.taskId);
        }
      }

      if (ready.length) {
        // Rien ne se pose sur le site tant que tu n'as pas regardé.
        setMediaProposals((current) => [...current, ...ready]);
        setMediaLeft(pending.size);
        toast.success(`${ready.length} visuel(s) à valider`);
      }

      setMediaLeft(pending.size);
      setMediaRun((current) =>
        current ? { ...current, done: current.total - pending.size } : current
      );
      if (!pending.size) {
        if (mediaPollRef.current) window.clearInterval(mediaPollRef.current);
        setMediaRun(null);
        stopClockIfIdle(packRun, null);
      }
    }, 4000);
  }

  /** Démarre le chrono s'il ne tourne pas déjà : deux fournées le partagent. */
  function startClock() {
    if (clockRef.current) return;
    setRunSeconds(0);
    clockRef.current = window.setInterval(() => setRunSeconds((value) => value + 1), 1000);
  }

  /** Coupe le chrono quand plus rien ne tourne. */
  function stopClockIfIdle(packs: unknown, media: unknown) {
    if (!packs && !media && clockRef.current) {
      window.clearInterval(clockRef.current);
      clockRef.current = null;
    }
  }

  /** Où va un visuel validé, selon la place qu'il occupait dans la commande. */
  function applyMedia(items: Array<{ key: string; url: string }>) {
    if (!items.length) return;
    setDraft((current) => {
      if (!current) return current;
      let next = { ...current };
      for (const item of items) {
        if (item.key === "hero") next.heroImageUrl = item.url;
        else if (item.key.startsWith("lifestyle:")) {
          /*
           * Une ambiance remplace celle de sa place, elle ne s'y ajoute pas.
           *
           * L'ajout en fin de liste faisait grossir le tableau à chaque
           * relance, et la page n'affiche que les deux premières : les plus
           * anciennes restaient en tête. On regénérait, on enregistrait, et le
           * site continuait de montrer les images d'avant — sans que rien ne
           * soit cassé, ce qui rendait le symptôme incompréhensible.
           */
          const slot = Number(item.key.slice("lifestyle:".length));
          const list = [...(next.lifestyleUrls || [])];
          if (Number.isInteger(slot) && slot >= 0) list[slot] = item.url;
          else list.push(item.url);
          next.lifestyleUrls = list.filter(Boolean);
        } else if (item.key.startsWith("category:")) {
          const id = item.key.slice("category:".length);
          next = {
            ...next,
            categories: next.categories.map((category) =>
              category.id === id ? { ...category, imageUrl: item.url } : category
            ),
          };
        }
      }
      return next;
    });
    const keys = new Set(items.map((item) => item.key + item.url));
    setMediaProposals((current) => current.filter((item) => !keys.has(item.key + item.url)));
    toast.success(`${items.length} visuel(s) posés — enregistre pour les garder`);
  }

  /** Le nom lisible d'un emplacement, pour savoir ce qu'on valide. */
  function mediaSlotLabel(key: string) {
    if (key === "hero") return "Bannière d'accueil";
    if (key.startsWith("lifestyle:")) return "Scène d'ambiance";
    const id = key.slice("category:".length);
    const category = draft?.categories.find((entry) => entry.id === id);
    return `Catégorie · ${category?.label || id}`;
  }

  /**
   * Ajoute au catalogue les produits d'un autre site.
   *
   * Le clone construit une boutique d'un coup ; ici on complète l'existante,
   * par exemple pour atteindre les quatre produits que réclame la checklist ou
   * pour piocher une gamme ailleurs. Les produits arrivent intacts — nom, prix,
   * texte, photo — et leur photo devient le gabarit de leur futur packaging,
   * exactement comme ceux venus de la copie initiale.
   */
  /**
   * Les produits d'une autre de tes boutiques, ajoutés à celle-ci.
   *
   * Ils arrivent complets — nom, prix, description mise en page, bénéfices —
   * mais sans leur packaging : il porte l'autre marque. La photo d'origine
   * reste comme gabarit, « Générer les packagings » refait les visuels aux
   * couleurs d'ici.
   */
  function addProductsFromSite(siteId: string) {
    if (!draft) return;
    const source = sites.find((site) => site.id === siteId);
    if (!source) return;
    const known = new Set(draft.products.map((product) => product.handle));
    const added = source.products
      .filter((product) => !known.has(product.handle))
      .map((product) => ({
        ...product,
        category: draft.categories.some((entry) => entry.id === product.category) ? product.category : draft.categories[0]?.id || "",
        imageUrl: "",
        sourceImageUrl: product.sourceImageUrl || product.imageUrl || "",
        packagingTaskId: null,
      }));
    if (!added.length) {
      toast.error(`Tous les produits de ${source.brandName} sont déjà là`);
      return;
    }
    patchDraft({ products: [...draft.products, ...added] });
    toast.success(`${added.length} produit(s) repris de ${source.brandName} — génère les packagings pour les mettre à ta marque`);
  }

  /** Un produit vide, à remplir dans le catalogue ou directement dans l'aperçu. */
  function addBlankProduct() {
    if (!draft) return;
    const index = draft.products.length + 1;
    let handle = `new-product-${index}`;
    while (draft.products.some((product) => product.handle === handle)) handle = `${handle}-${Math.random().toString(36).slice(2, 5)}`;
    patchDraft({
      products: [
        ...draft.products,
        {
          handle,
          name: `New product ${index}`,
          subtitle: "",
          category: draft.categories[0]?.id || "",
          price: 29.99,
          compareAtPrice: null,
          dosage: "",
          description: "Describe the product here: what it is, who it is for, what it does.",
          bullets: [],
          usage: "",
          ingredients: "",
          imageUrl: "",
          packagingTaskId: null,
          badge: "",
        },
      ],
    });
    setOpenPath({ path: `/product/${handle}`, nonce: Date.now() });
  }

  async function addProductsFrom(domain: string) {
    if (!draft || !domain.trim()) return;
    setBusy("add-products");
    try {
      const res = await fetch("/api/ecom-sites/reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", domain }),
      });
      const read = await res.json();
      if (!res.ok) throw new Error(read.error);

      // Les identifiants déjà pris comptent aussi : deux « VIP » ajoutés à la
      // suite ne doivent pas retomber l'un sur l'autre.
      const known = new Set(draft.products.map((product) => product.handle));
      const added = (read.products || [])
        .map((source: RefProduct) => ({
          handle: (source.name || source.handle)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "")
            .slice(0, 60),
          name: source.name || "",
          subtitle: "",
          category: draft.categories[0]?.id || "",
          price: Math.min(source.price > 0 ? source.price : 29.99, 79.99),
          compareAtPrice: null,
          dosage: source.dosage || "",
          description: source.description || "",
          bullets: [],
          usage: "",
          ingredients: "",
          imageUrl: source.imageUrl || "",
          sourceImageUrl: source.imageUrl || "",
          packagingTaskId: null,
          badge: "",
        }))
        .filter((product: { handle: string }) => {
          if (!product.handle) return false;
          if (known.has(product.handle)) return false;
          known.add(product.handle);
          return true;
        });

      if (!added.length) throw new Error(`Rien de nouveau sur ${domain}`);
      patchDraft({ products: [...draft.products, ...added] });
      setAddFrom("");
      toast.success(
        `${added.length} produit(s) ajoutés depuis ${read.domain} — charge ton logo pour leurs packagings`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ajout impossible");
    } finally {
      setBusy(null);
    }
  }

  function patchDraft(patch: Partial<EcomSite>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  /* ---------------- Pages ajoutées ---------------- */

  function showPage(page: EcomPage) {
    setOpenPath({ path: `/${page.slug}`, nonce: Date.now() });
  }

  /** Reprend le contenu d'une page depuis son adresse — sans son header ni son footer. */
  async function importPageFromUrl() {
    if (!draft || !pageUrl.trim()) return;
    setBusy("page-import");
    try {
      const res = await fetch("/api/ecom-sites/page-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: pageUrl, taken: (draft.pages ?? []).map((page) => page.slug) }),
      });
      const body = (await res.json()) as { page?: EcomPage; error?: string };
      if (!res.ok || !body.page) throw new Error(body.error || "Import impossible");
      const page = body.page;
      patchDraft({ pages: [...(draft.pages ?? []), page] });
      setPageUrl("");
      toast.success(`Page « ${page.title} » ajoutée — ${page.blocks.length} blocs`);
      showPage(page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import impossible");
    } finally {
      setBusy(null);
    }
  }

  function addBlankPage() {
    if (!draft || !pageTitle.trim()) return;
    const page = blankPage(pageTitle, draft);
    patchDraft({ pages: [...(draft.pages ?? []), page] });
    setPageTitle("");
    showPage(page);
  }

  function patchPage(id: string, patch: Partial<EcomPage>) {
    if (!draft) return;
    const page = (draft.pages ?? []).find((entry) => entry.id === id);
    const next: Partial<EcomSite> = { pages: (draft.pages ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) };
    /* Un menu réécrit à la main ne se déduit plus : on y ajoute ou retire le lien nous-mêmes. */
    if (draft.nav && page && patch.inNav !== undefined) {
      const href = `/${page.slug}`;
      next.nav = patch.inNav ? (draft.nav.some((item) => item.href === href) ? draft.nav : [...draft.nav, { label: page.title, href }]) : draft.nav.filter((item) => item.href !== href);
    }
    patchDraft(next);
  }

  function removePage(id: string) {
    if (!draft) return;
    const page = (draft.pages ?? []).find((entry) => entry.id === id);
    patchDraft({
      pages: (draft.pages ?? []).filter((entry) => entry.id !== id),
      nav: draft.nav && page ? draft.nav.filter((item) => item.href !== `/${page.slug}`) : draft.nav,
    });
    setOpenPath({ path: "/", nonce: Date.now() });
  }

  /* ---------------- Menu du header ---------------- */

  /** Le menu tel qu'il s'écrit : celui qu'on a réécrit, sinon celui déduit, figé au premier geste. */
  function navDraft() {
    if (!draft) return [];
    return draft.nav ?? navItems(draft).map((item) => ({ label: item.label, href: item.path }));
  }

  function editNav(index: number, patch: Partial<{ label: string; href: string }>) {
    patchDraft({ nav: navDraft().map((item, at) => (at === index ? { ...item, ...patch } : item)) });
  }

  function moveNav(index: number, delta: number) {
    const items = [...navDraft()];
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    patchDraft({ nav: items });
  }

  function removeNav(index: number) {
    patchDraft({ nav: navDraft().filter((_, at) => at !== index) });
  }

  function addNav() {
    patchDraft({ nav: [...navDraft(), { label: "New link", href: "/shop" }] });
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    try {
      const res = await fetch(`/api/ecom-sites/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setDraft(body.site);
      // Le repère de comparaison suit ce que le serveur vient d'accepter.
      setSaved(JSON.stringify(body.site));
      setChecklist(body.checklist || []);
      await loadList();
      // Enregistrer, c'est publier : la vitrine sert le site stocké.
      toast.success(
        `En ligne — /s/${body.site.slug}`,
        {
          action: {
            label: "Ouvrir",
            onClick: () => window.open(`/s/${body.site.slug}`, "_blank"),
          },
        }
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!newBrand.trim()) {
      toast.error("Nom de marque requis");
      return;
    }
    setBusy("create");
    try {
      const res = await fetch("/api/ecom-sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandName: newBrand, cloneOf: cloneOf || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNewBrand("");
      setCloneOf("");
      await loadList();
      await loadSite(body.site.id);
      toast.success(cloneOf ? "Site dupliqué" : "Site créé");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Création impossible");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Supprimer ce site ?")) return;
    await fetch(`/api/ecom-sites/${id}`, { method: "DELETE" });
    if (selectedId === id) {
      setSelectedId(null);
      setDraft(null);
      setChecklist([]);
    }
    await loadList();
  }

  /**
   * Le logo déposé enchaîne sur les packagings.
   *
   * Tant qu'ils ne sont pas générés, la boutique affiche les photos du site
   * modèle — donc la marque de quelqu'un d'autre. C'est l'état le plus risqué du
   * parcours, et le seul moyen d'en sortir demandait jusqu'ici de penser à
   * cliquer un bouton. Le logo est justement ce qui manquait pour le faire.
   */
  /**
   * Le logo est enregistré, et rien d'autre.
   *
   * Il déclenchait les packagings ; ça arrivait trop tôt, avant que le fichier
   * soit posé côté serveur, et les packs sortaient sans marque. Le bouton reste
   * à côté : on le clique quand on est prêt.
   */
  function onLogo(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () =>
      patchDraft({ logoDataUrl: await trimLogo(String(reader.result || "")) });
    reader.readAsDataURL(file);
  }

  /** Copy de marque + fiches produit, écrites par Claude via Kie. */
  async function generateCopy() {
    if (!draft) return;
    setBusy("copy");
    try {
      const res = await fetch("/api/ecom-sites/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: draft.brandName,
          niche,
          productCount,
          pricePoints: [...PRICE_POINTS],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      /*
       * Un catalogue existant n'est jamais remplacé.
       *
       * Cette route invente des produits à partir d'une niche. Appliquée à une
       * boutique copiée, elle jetait les vingt références réelles pour six
       * inventées — et le modèle, à qui on demande six produits d'une même
       * famille, se répète. C'était l'origine des doublons.
       *
       * Sur un site qui a déjà des produits, on ne garde donc que les textes de
       * marque : le catalogue vient du site modèle, il n'a pas à être réécrit.
       */
      const brand = {
        tagline: body.tagline,
        heroTitle: body.heroTitle,
        heroSubtitle: body.heroSubtitle,
        promise: body.promise,
        productDisclaimer: body.productDisclaimer,
        pillars: body.pillars,
        categories: body.categories,
      };

      if (draft.products.length) {
        patchDraft(brand);
        toast.success("Textes de marque écrits — le catalogue est conservé");
        return;
      }

      patchDraft({
        ...brand,
        products: body.products.map((product: EcomSite["products"][number]) => ({
          ...product,
          imageUrl: "",
          packagingTaskId: null,
        })),
      });
      toast.success(`${body.products.length} produits écrits — pense à enregistrer`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setBusy(null);
    }
  }

  /** Packagings brandés : Kie gpt-image-2, le logo du site en référence. */
  async function generatePackaging() {
    if (!draft) return;
    if (!draft.logoDataUrl) {
      toast.error("Charge le logo avant de générer les packagings");
      return;
    }
    setBusy("packaging");
    try {
      // Le site doit être à jour côté serveur : la route lit les produits stockés.
      await fetch(`/api/ecom-sites/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });

      const res = await fetch("/api/ecom-sites/packaging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Une sélection restreint la fournée ; sans sélection, tout y passe.
        body: JSON.stringify({
          action: "generate",
          siteId: draft.id,
          handles: pickedProducts.length ? pickedProducts : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);

      const jobs: Array<{ handle: string; taskId: string | null; error: string | null }> = body.jobs || [];
      const failed = jobs.filter((job) => job.error);
      if (failed.length) toast.error(`${failed.length} produit(s) non lancés`);
      const launched = jobs.filter((job) => job.taskId) as Array<{ handle: string; taskId: string }>;
      toast.success(`${launched.length} packagings en génération`);
      setPackRun({ done: 0, total: launched.length });
      startClock();
      startPolling(draft.id, launched);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Génération impossible");
    } finally {
      setBusy(null);
    }
  }

  function startPolling(siteId: string, jobs: Array<{ handle: string; taskId: string }>) {
    if (!jobs.length) return;
    if (pollRef.current) window.clearInterval(pollRef.current);
    const pending = new Map(jobs.map((job) => [job.taskId, job.handle]));
    /** Le premier pack sorti sert de référence aux scènes d'ambiance. */
    let firstPack = "";

    pollRef.current = window.setInterval(async () => {
      if (!pending.size) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        return;
      }
      const res = await fetch("/api/ecom-sites/packaging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", taskIds: [...pending.keys()] }),
      });
      const body = await res.json();
      const done: Array<{ handle: string; url: string }> = [];

      for (const result of body.results || []) {
        const handle = pending.get(result.taskId);
        if (!handle) continue;
        if (result.urls?.length) {
          done.push({ handle, url: result.urls[0] });
          pending.delete(result.taskId);
        } else if (result.state === "fail") {
          pending.delete(result.taskId);
          toast.error(`${handle} : ${result.failMsg || "échec"}`);
        }
      }

      if (done.length) {
        setDraft((current) => {
          if (!current || current.id !== siteId) return current;
          const byHandle = new Map(done.map((item) => [item.handle, item.url]));
          return {
            ...current,
            products: current.products.map((product) =>
              byHandle.has(product.handle)
                ? { ...product, imageUrl: byHandle.get(product.handle)!, packagingTaskId: null }
                : product
            ),
          };
        });
        if (!firstPack) firstPack = done[0].url;

        /*
         * On les pose côté serveur sans attendre un clic.
         *
         * Le brouillon suffisait tant qu'on restait sur la page ; fermer
         * l'onglet avant d'enregistrer perdait des images déjà générées et
         * facturées. La route ne touche que ces produits-là, donc la saisie en
         * cours dans les autres champs n'est pas écrasée.
         */
        void fetch("/api/ecom-sites/packaging", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "attach", siteId, ready: done }),
        }).catch(() => {});

        toast.success(`${done.length} packaging(s) prêt(s)`);
      }

      setPackRun((current) =>
        current ? { ...current, done: current.total - pending.size } : current
      );

      if (!pending.size) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setPackRun(null);
        stopClockIfIdle(null, mediaRun);
        /*
         * La fournée finie, les scènes repartent avec le pack dans le cadre.
         *
         * Au premier passage elles sortent vides — elles sont lancées dès la
         * copie, avant que le moindre packaging n'existe. C'est ici, et
         * seulement ici, qu'on a de quoi montrer le produit sur l'étagère.
         */
        if (firstPack) void generateMedia(siteId, firstPack);
      }
    }, 4000);
  }

  /** Combien de packagings sont encore en génération, pour l'afficher. */
  const pendingPackaging = draft?.products.filter((product) => product.packagingTaskId).length ?? 0;

  /**
   * Enregistrement automatique, une seconde apres la derniere frappe.
   *
   * Deux sessions de travail ont ete perdues parce que le brouillon vivait dans
   * le navigateur : une generation qui se termine, un onglet ferme, et tout
   * repartait. La sauvegarde suit desormais le travail au lieu d'attendre un
   * clic. Le delai evite d'ecrire a chaque caractere, et rien ne part tant que
   * rien n'a change ni pendant une sauvegarde manuelle.
   */
  useEffect(() => {
    if (!draft || !saved) return;
    const payload = JSON.stringify(draft);
    if (payload === saved) return;
    if (busy === "save") return;
    const id = window.setTimeout(() => void autoSave(payload), 1000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, saved, busy]);

  /** Ecrit sans rien afficher : c'est un filet, pas une action. */
  async function autoSave(payload: string) {
    if (!draft) return;
    try {
      const res = await fetch(`/api/ecom-sites/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (!res.ok) return;
      const body = await res.json();
      // On ne remplace pas le brouillon : la frappe en cours passerait a la trappe.
      setSaved(JSON.stringify(body.site));
      setChecklist(body.checklist || []);
    } catch {
      // Hors ligne ou serveur qui recompile : la prochaine frappe reessaiera.
    }
  }

  /**
   * Ce qu'une image cliquée dans l'aperçu désigne, et où ranger son remplacement.
   *
   * L'aperçu ne connaît que des clés — « hero », « lifestyle:1 »,
   * « product:mon-serum ». La correspondance vit ici, avec le brouillon.
   */
  function targetForImageKey(key: string, src: string): ImageTarget | null {
    if (!draft) return null;
    if (key === "hero")
      return { label: "Bannière d'accueil", current: src, apply: (url) => patchDraft({ heroImageUrl: url }) };
    if (key === "about")
      return { label: "Photo de l'à-propos", current: src, apply: (url) => patchDraft({ aboutImageUrl: url }) };
    if (key.startsWith("category:")) {
      const id = key.slice("category:".length);
      const found = draft.categories.find((entry) => entry.id === id);
      return {
        label: `Catégorie · ${found?.label || id}`,
        current: src,
        apply: (url) =>
          patchDraft({
            categories: draft.categories.map((entry) => (entry.id === id ? { ...entry, imageUrl: url } : entry)),
          }),
      };
    }
    if (key.startsWith("lifestyle:")) {
      const index = Number(key.slice("lifestyle:".length));
      return {
        label: `Ambiance ${index + 1}`,
        current: src,
        apply: (url) =>
          patchDraft({
            lifestyleUrls: (draft.lifestyleUrls || []).map((entry, i) => (i === index ? url : entry)),
          }),
      };
    }
    if (key.startsWith("section:")) {
      const id = key.slice("section:".length);
      return {
        label: "Bloc image",
        current: src,
        apply: (url) => editSection(id, { imageUrl: url }),
      };
    }
    if (key.startsWith("product:")) {
      const handle = key.slice("product:".length);
      const product = draft.products.find((entry) => entry.handle === handle);
      return {
        label: `Packaging · ${product?.name?.slice(0, 34) || handle}`,
        current: src,
        apply: (url) =>
          patchDraft({
            products: draft.products.map((entry) =>
              entry.handle === handle ? { ...entry, imageUrl: url } : entry
            ),
          }),
      };
    }
    return null;
  }

  /* --- Mise en page de la page d'accueil --- */

  /**
   * Les sections du brouillon, dérivées au besoin.
   *
   * Un site copié avant cette fonctionnalité n'a qu'un ordre de blocs. On le
   * convertit à la volée : la première retouche enregistre le résultat, et
   * rien n'a besoin d'être migré d'avance.
   */
  const sections = draft ? sectionsOf(draft) : [];

  function patchSections(next: EcomSection[]) {
    patchDraft({ sections: next });
  }

  /**
   * Deplacement par glisser-deposer.
   *
   * Deux fleches par ligne demandaient un clic par cran : descendre une section
   * de cinq rangs en faisait cinq. On attrape la ligne et on la depose.
   */
  function dropSection(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    patchSections(next);
  }

  function moveSection(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    patchSections(next);
  }

  /**
   * Déplacement commandé depuis l'aperçu.
   *
   * L'aperçu ne connaît que les sections visibles ; la liste, elle, garde aussi
   * les masquées. On raisonne donc sur des identifiants et non sur des rangs :
   * la section attrapée se replace juste avant ou juste après celle qu'on a
   * survolée, et les blocs masqués gardent leur place autour.
   */
  function reorderSections(id: string, over: string, place: "before" | "after") {
    const from = sections.findIndex((section) => section.id === id);
    if (from < 0 || id === over) return;
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    const target = next.findIndex((section) => section.id === over);
    if (target < 0) return;
    next.splice(place === "after" ? target + 1 : target, 0, moved);
    patchSections(next);
    setPicked(id);
  }

  function editSection(id: string, patch: Partial<EcomSection>) {
    patchSections(sections.map((section) => (section.id === id ? { ...section, ...patch } : section)));
  }

  /**
   * Les cartes du bandeau de réassurance.
   *
   * Tant qu'on n'y a pas touché, la section n'en porte aucune et le rendu
   * déduit les trois cartes des réglages de la boutique. La première retouche
   * fige cette déduction dans la section : à partir de là c'est la liste qui
   * compte, et changer le seuil de port offert ne réécrit plus la carte qu'on
   * vient d'ajuster.
   */
  function patchAssurances(section: EcomSection, next: Array<{ title: string; body: string }>) {
    editSection(section.id, { items: next });
  }

  function editAssurance(section: EcomSection, index: number, patch: Partial<{ title: string; body: string }>) {
    if (!draft) return;
    patchAssurances(
      section,
      assuranceItems(draft, section).map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  }

  function addAssurance(section: EcomSection) {
    if (!draft) return;
    patchAssurances(section, [...assuranceItems(draft, section), { title: "", body: "" }]);
  }

  function removeAssurance(section: EcomSection, index: number) {
    if (!draft) return;
    patchAssurances(
      section,
      assuranceItems(draft, section).filter((_, i) => i !== index)
    );
  }

  function addSection(block: EcomSection["block"]) {
    patchSections([
      ...sections,
      { id: newSectionId(), block, align: "left", space: "normal", title: "", body: "", imageUrl: "" },
    ]);
  }

  /* --- Pied de page --- */

  /**
   * Le footer se règle par écrasement, pas par recopie.
   *
   * Chaque champ absent reste déduit du site : tant qu'on n'a pas touché aux
   * colonnes, ce sont les politiques et les liens de boutique qui s'affichent,
   * et ajouter une politique la fait apparaître toute seule. Écrire dans un
   * champ le fige — c'est le prix d'une page qu'on compose soi-même.
   */
  function patchFooter(patch: Partial<EcomFooter>) {
    patchDraft({ footer: { ...(draft?.footer ?? {}), ...patch } });
  }

  const footerCols: FooterColumn[] = draft ? footerColumns(draft) : [];

  function editFooterColumn(index: number, patch: Partial<FooterColumn>) {
    patchFooter({ columns: footerCols.map((column, i) => (i === index ? { ...column, ...patch } : column)) });
  }

  /**
   * Le texte d'une colonne, ecrit a partir de la boutique.
   *
   * C'est le brouillon qui part, pas le site enregistre : on vient peut-etre de
   * renommer la marque ou de retirer la moitie du catalogue, et le paragraphe
   * doit parler de ce qu'on a sous les yeux. Le logo en base64 reste ici — il
   * pese plus que tout le reste du site et n'apprend rien au modele.
   */
  async function writeFooterColumn(index: number) {
    if (!draft) return;
    setFooterBusy(index);
    try {
      const res = await fetch("/api/ecom-sites/footer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: draft.id,
          title: footerCols[index].title || "About",
          draft: { ...draft, logoDataUrl: "" },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      editFooterColumn(index, { body: body.text });
      toast.success(
        body.written ? "Texte du pied de page ecrit" : "Texte de repli pose — relance pour le faire reecrire"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Texte impossible");
    } finally {
      setFooterBusy(null);
    }
  }

  function editFooterLink(index: number, linkIndex: number, patch: Partial<{ label: string; href: string }>) {
    editFooterColumn(index, {
      links: footerCols[index].links.map((link, i) => (i === linkIndex ? { ...link, ...patch } : link)),
    });
  }

  /**
   * Doublons du catalogue, repérés sur le nom.
   *
   * C'est le nom qu'on lit dans la liste, donc c'est lui qui doit servir de
   * clé : deux entrées au même nom sont un doublon même si leurs identifiants
   * diffèrent, et l'inverse ne se voit pas à l'œil.
   */
  const duplicateHandles = (() => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const product of draft?.products ?? []) {
      const key = product.name.trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) dups.push(product.handle);
      else seen.set(key, product.handle);
    }
    return dups;
  })();

  const score = selectedId ? scores[selectedId] : null;

  return (
    <div className="space-y-4">
      {/* Le parcours, énoncé une fois en haut.
          Un écran qui offre douze boutons sans dire par lequel commencer se
          traverse à tâtons. Cinq lignes suffisent à savoir où on va. */}
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-slate-900 px-3 py-2.5 text-[12px] text-white dark:bg-slate-800">
        {[
          "Nomme ta marque, charge ton logo et tes couleurs",
          "Lis un modèle et coche les produits voulus",
          "Copie",
          "Remplis LLC, adresse et support",
          "Publie",
        ].map((step, index) => (
          <li key={step} className="flex items-center gap-2">
            {index ? <span className="text-white/30">→</span> : null}
            <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white text-[9px] font-bold text-slate-900">
              {index + 1}
            </span>
            <span className="text-white/85">{step}</span>
          </li>
        ))}
      </ol>

      {/* ---------------- Modèles ---------------- */}
      <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <h3 className="text-[12px] font-semibold">1 · Ta marque, puis le modèle à copier</h3>
          <span className="text-[11px] text-slate-400">
            Mêmes produits, mêmes prix — packagings et visuels refaits à tes couleurs.
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <input
              value={newReference}
              onChange={(e) => setNewReference(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addReference();
              }}
              placeholder="ajouter un site modèle.com"
              className={cn(field, "w-52")}
            />
            <button
              type="button"
              onClick={() => void addReference()}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-[11px] font-semibold dark:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </button>
          </div>
        </div>

        {/* Marque + thème appliqués à la copie qu'on lance juste après.

            Tant que le nom manque, le bandeau se signale et les boutons Copier
            restent fermés : c'est la seule chose à faire en arrivant, et une
            interface qui laisse tout cliquable ne le dit pas. */}
        <div
          className={cn(
            "mb-2.5 flex flex-wrap items-end gap-2 rounded-xl p-2",
            copyBrand.trim()
              ? "bg-slate-50 dark:bg-slate-800/60"
              : "bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/40"
          )}
        >
          <Labelled text="Marque de la copie">
            <input
              value={copyBrand}
              onChange={(e) => setCopyBrand(e.target.value)}
              placeholder="GlowProof"
              autoFocus
              className={cn(field, "w-44")}
            />
          </Labelled>
          <Labelled text="Couleurs">
            <select
              value={copyTheme}
              onChange={(e) => setCopyTheme(e.target.value as EcomThemeId)}
              className={cn(field, "w-44")}
            >
              {ECOM_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>{theme.label}</option>
              ))}
            </select>
          </Labelled>
          {/* Le logo est posé ici, avant la copie. C'est ce qui permet aux
              packagings et aux visuels de partir tout seuls derrière : sans lui,
              ils sortiraient sans marque. */}
          <Labelled text="Logo">
            <label className="flex h-8 w-40 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-white text-[11px] font-semibold dark:bg-slate-900">
              {copyLogo ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={copyLogo} alt="" className="h-5 w-auto max-w-[80px] object-contain" />
                  <span className="text-emerald-600">✓</span>
                </>
              ) : (
                <>
                  <ImagePlus className="h-3.5 w-3.5" />
                  Charger
                </>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = async () => setCopyLogo(await trimLogo(String(reader.result || "")));
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          </Labelled>

          <Labelled text="Couleurs de marque">
            <div className="flex h-8 items-center gap-1.5">
              <input
                type="color"
                value={copyPrimary}
                onChange={(event) => setCopyPrimary(event.target.value)}
                title="Couleur principale"
                className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <input
                type="color"
                value={copySecondary}
                onChange={(event) => setCopySecondary(event.target.value)}
                title="Couleur secondaire"
                className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
              />
            </div>
          </Labelled>

          {/* La phrase dit ce qu'il reste à faire, pas ce que fait le champ. */}
          {copyBrand.trim() ? (
            <span className="pb-1.5 text-[11px] text-slate-400">
              Logo et couleurs posés ici : packagings et visuels s&apos;enchaînent après la copie.
            </span>
          ) : (
            <span className="pb-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              Commence ici : nomme ta marque, puis clique « Copier » sur le site à reproduire.
            </span>
          )}
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {references.map((reference) => (
            <div key={reference.domain} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold">{reference.label}</p>
                  <p className="truncate text-[11px] text-slate-400">{reference.domain}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeReference(reference.domain)}
                  className="text-slate-300 hover:text-rose-600"
                  aria-label={`Retirer ${reference.domain}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {reference.productCount === null ? "jamais lu" : `${reference.productCount} produits`}
              </p>
              <div className="mt-2 flex gap-1">
                <button
                  type="button"
                  onClick={() => void readReference(reference.domain)}
                  disabled={busy === `read:${reference.domain}`}
                  className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-white text-[11px] font-semibold disabled:opacity-50 dark:bg-slate-900"
                >
                  {busy === `read:${reference.domain}` ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Lire
                </button>
                <button
                  type="button"
                  onClick={() => void copyReference(reference.domain)}
                  disabled={busy === `copy:${reference.domain}` || !copyBrand.trim()}
                  title={
                    copyBrand.trim()
                      ? `Copier ${reference.domain} sous le nom ${copyBrand.trim()}`
                      : "Donne d'abord un nom à ta marque, en haut"
                  }
                  className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-slate-900 text-[11px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
                >
                  {busy === `copy:${reference.domain}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  Copier
                </button>
              </div>

              {/* Copie éclair : le catalogue sans l'étape de réécriture.

                  C'est la même copie — mêmes produits, mêmes prix, mêmes photos
                  — moins les textes de marque, qui sont écrits d'avance. Deux
                  secondes au lieu de deux minutes, et elle aboutit même quand
                  le fournisseur de modèles est en carafe. */}
              <button
                type="button"
                onClick={() => void copyReference(reference.domain, true)}
                disabled={busy === `copy:${reference.domain}` || !copyBrand.trim()}
                title="Même copie, sans passer par l'IA pour les textes : 2 secondes au lieu de 2 minutes"
                className="mt-1 inline-flex h-6 w-full items-center justify-center gap-1 rounded-md bg-emerald-50 text-[10.5px] font-semibold text-emerald-700 disabled:opacity-40 dark:bg-emerald-500/15 dark:text-emerald-300"
              >
                <Zap className="h-3 w-3" />
                Copie immédiate
              </button>

              {/* La copie prend une bonne minute : on dit à quelle étape on en
                  est et depuis combien de temps, plutôt que de laisser tourner
                  une roue muette. */}
              {busy === `copy:${reference.domain}` && copyStep ? (
                <div className="mt-2 rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-slate-500" />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                      {copyStep.label}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                      {copySeconds}s
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                      style={{ width: `${Math.round((copyStep.done / 3) * 100)}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {preview ? (
          <div className="mt-3 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <p className="mb-1.5 text-[11px] font-semibold">
              Catalogue source · {preview.domain} · {preview.products.length} produits
            </p>
            {/* Choisir avant de copier, plutôt que d'importer vingt références
                pour en supprimer quinze ensuite. Rien de coché = tout. */}
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setCopyPicks(
                    copyPicks.length === preview.products.length
                      ? []
                      : preview.products.map((product) => product.handle)
                  )
                }
                className="rounded-md bg-white px-2 py-0.5 text-[10px] font-semibold dark:bg-slate-900"
              >
                {copyPicks.length === preview.products.length ? "Tout décocher" : "Tout cocher"}
              </button>
              <span className="text-[10px] text-slate-400">
                {copyPicks.length
                  ? `${copyPicks.length} retenu(s) — seuls ceux-là seront copiés`
                  : "aucun coché : tout le catalogue sera copié"}
              </span>
            </div>

            <div className="space-y-1">
              {preview.products.map((product) => (
                <label
                  key={product.handle}
                  className="flex cursor-pointer items-baseline gap-2 rounded px-1 text-[11px] hover:bg-white dark:hover:bg-slate-900"
                >
                  <input
                    type="checkbox"
                    checked={copyPicks.includes(product.handle)}
                    onChange={() =>
                      setCopyPicks((current) =>
                        current.includes(product.handle)
                          ? current.filter((handle) => handle !== product.handle)
                          : [...current, product.handle]
                      )
                    }
                    className="shrink-0 self-center"
                  />
                  <span className="w-14 shrink-0 font-bold">${product.price}</span>
                  <span className="w-40 shrink-0 truncate text-slate-400">{product.dosage}</span>
                  <span className="min-w-0 flex-1 truncate">{product.name}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Trois colonnes quand l'apercu est ouvert : la liste, les reglages,
          la boutique. En dessous de 1536 px il n'y a pas la place pour les
          trois, l'apercu passe alors sous les reglages. */}
      <div
        className={cn(
          "grid gap-4",
          showPreview && draft
            ? "lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,440px)_minmax(0,1fr)]"
            : "lg:grid-cols-[280px_minmax(0,1fr)]"
        )}
      >
      {/* ---------------- Colonne gauche : liste + création ---------------- */}
      <div className="space-y-3">
        <div className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          <p className={label}>Nouveau site</p>
          <input
            value={newBrand}
            onChange={(e) => setNewBrand(e.target.value)}
            placeholder="Nom de marque"
            className={field}
          />
          <select value={cloneOf} onChange={(e) => setCloneOf(e.target.value)} className={field}>
            <option value="">Partir de zéro</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                Dupliquer · {site.brandName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy === "create"}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {busy === "create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Créer
          </button>
        </div>

        <div className="space-y-1.5">
          {loading ? (
            <p className="px-1 text-[12px] text-slate-400">Chargement…</p>
          ) : sites.length === 0 ? (
            <p className="px-1 text-[12px] text-slate-400">Aucun site pour l&apos;instant.</p>
          ) : (
            sites.map((site) => {
              const siteScore = scores[site.id];
              return (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => void loadSite(site.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left ring-1 transition",
                    selectedId === site.id
                      ? "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900"
                      : "bg-white ring-slate-900/[0.06] hover:bg-slate-50 dark:bg-slate-900/70 dark:hover:bg-slate-800"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold">{site.brandName}</span>
                    <span className="block truncate text-[11px] opacity-60">{site.domain || "domaine non défini"}</span>
                  </span>
                  {siteScore ? (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                        siteScore.ready ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      )}
                    >
                      {siteScore.ready ? "prêt" : `${siteScore.fails}`}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ---------------- Colonne droite : éditeur ---------------- */}
      {!draft ? (
        <div className="grid place-items-center rounded-2xl bg-white p-10 text-[12px] text-slate-400 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
          Sélectionne un site, ou crée-en un.
        </div>
      ) : (
        <div className="space-y-3">
          {/* La barre d'action suit le defilement.

              Les reglages tiennent sur plusieurs ecrans : le bouton d'enregistrement
              disparaissait des qu'on descendait, et on ne savait plus si le travail
              etait sauve. */}
          <div className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-2xl bg-white/95 p-3 shadow-sm ring-1 ring-slate-900/[0.06] backdrop-blur dark:bg-slate-900/95">
            <span className="text-[13px] font-semibold">{draft.brandName}</span>
            <a
              href={`/s/${draft.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium dark:bg-slate-800"
            >
              <ExternalLink className="h-3 w-3" />
              Voir le site
            </a>
            {/* L'apercu vivant. Ouvert par defaut : c'est lui qui transforme le
                formulaire en editeur, et le refermer rend la place aux reglages
                sur un petit ecran. */}
            <button
              type="button"
              onClick={() => setShowPreview((value) => !value)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold",
                showPreview
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-slate-100 dark:bg-slate-800"
              )}
            >
              <Monitor className="h-3 w-3" />
              Apercu
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy === "save"}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Enregistrer
              </button>
              <button type="button" onClick={() => void remove(draft.id)} className="rounded-md px-2 py-1 text-[11px] text-rose-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Identité */}
          <Section title="Identité">
            <div className="grid gap-2 sm:grid-cols-2">
              <Labelled text="Marque">
                <input value={draft.brandName} onChange={(e) => patchDraft({ brandName: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Domaine">
                <input value={draft.domain} onChange={(e) => patchDraft({ domain: e.target.value })} placeholder="brand.com" className={field} />
              </Labelled>
              <Labelled text="Tagline">
                <input value={draft.tagline} onChange={(e) => patchDraft({ tagline: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Thème de base">
                <select value={draft.themeId} onChange={(e) => patchDraft({ themeId: e.target.value as EcomThemeId })} className={field}>
                  {ECOM_THEMES.map((theme) => (
                    <option key={theme.id} value={theme.id}>{theme.label}</option>
                  ))}
                </select>
              </Labelled>

              {/* Deux couleurs de marque : elles priment sur le thème. */}
              <div className="sm:col-span-2 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
                <span className={label}>Couleurs de marque</span>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  Principale
                  <input
                    type="color"
                    value={draft.brandColors?.primary || ecomTheme(draft.themeId).accent}
                    onChange={(e) =>
                      patchDraft({
                        brandColors: {
                          primary: e.target.value,
                          secondary: draft.brandColors?.secondary || ecomTheme(draft.themeId).wash,
                        },
                      })
                    }
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  Fond
                  <input
                    type="color"
                    value={draft.brandColors?.secondary || ecomTheme(draft.themeId).wash}
                    onChange={(e) =>
                      patchDraft({
                        brandColors: {
                          primary: draft.brandColors?.primary || ecomTheme(draft.themeId).accent,
                          secondary: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                {draft.brandColors ? (
                  <button
                    type="button"
                    onClick={() => patchDraft({ brandColors: null })}
                    className="text-[11px] text-slate-400 underline"
                  >
                    Revenir au thème
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-400">Non définies — le thème s&apos;applique.</span>
                )}
              </div>
              <Labelled text="Titre hero">
                <input value={draft.heroTitle} onChange={(e) => patchDraft({ heroTitle: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Barre promo">
                <input value={draft.promoBar} onChange={(e) => patchDraft({ promoBar: e.target.value })} className={field} />
              </Labelled>
              <div className="sm:col-span-2">
                <Labelled text="Sous-titre hero">
                  <textarea rows={2} value={draft.heroSubtitle} onChange={(e) => patchDraft({ heroSubtitle: e.target.value })} className={area} />
                </Labelled>
              </div>
              <div className="sm:col-span-2 flex items-center gap-3">
                {draft.logoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.logoDataUrl} alt="logo" className="h-9 max-w-[140px] rounded bg-slate-50 object-contain p-1 dark:bg-slate-800" />
                ) : null}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-semibold dark:bg-slate-800">
                  <ImagePlus className="h-3.5 w-3.5" />
                  {draft.logoDataUrl ? "Remplacer le logo" : "Charger le logo"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
                </label>
                {draft.logoDataUrl ? (
                  <button type="button" onClick={() => patchDraft({ logoDataUrl: "" })} className="text-[11px] text-slate-400">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          </Section>

          {/* Header : logo et menu, l'aperçu suit chaque frappe */}
          <Section
            title="Header"
            right={
              draft.nav ? (
                <button type="button" onClick={() => patchDraft({ nav: undefined })} className="text-[10px] text-slate-500 underline-offset-2 hover:underline">
                  Revenir au menu automatique
                </button>
              ) : (
                <span className="text-[10px] text-slate-400">menu automatique : pages fixes + pages ajoutées</span>
              )
            }
          >
            <div className="flex items-center gap-3">
              {draft.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.logoDataUrl} alt="logo" className="h-9 max-w-[140px] rounded bg-slate-50 object-contain p-1 dark:bg-slate-800" />
              ) : (
                <span className="text-[12px] font-bold">{draft.brandName || "Logo"}</span>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-semibold dark:bg-slate-800">
                <ImagePlus className="h-3.5 w-3.5" />
                {draft.logoDataUrl ? "Remplacer le logo" : "Charger le logo"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
              </label>
              {draft.logoDataUrl ? (
                <button type="button" onClick={() => patchDraft({ logoDataUrl: "" })} title="Retirer le logo : le nom de la marque s'affiche" className="text-[11px] text-slate-400">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="mt-3 space-y-1.5">
              <span className={label}>Menu</span>
              {navDraft().map((item, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <input value={item.label} onChange={(e) => editNav(index, { label: e.target.value })} placeholder="Libellé" className={cn(field, "min-w-0 flex-1")} />
                  <input value={item.href} onChange={(e) => editNav(index, { href: e.target.value })} placeholder="/shop ou https://…" list="msgate-nav-paths" className={cn(field, "w-40 shrink-0 font-mono text-[11px]")} />
                  <span className="flex shrink-0 flex-col">
                    <button type="button" onClick={() => moveNav(index, -1)} disabled={index === 0} title="Monter" className="h-4 rounded px-1 text-[10px] leading-none text-slate-500 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-slate-800">
                      &#9650;
                    </button>
                    <button type="button" onClick={() => moveNav(index, 1)} disabled={index === navDraft().length - 1} title="Descendre" className="h-4 rounded px-1 text-[10px] leading-none text-slate-500 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-slate-800">
                      &#9660;
                    </button>
                  </span>
                  <button type="button" onClick={() => removeNav(index)} title="Retirer du menu" className="shrink-0 rounded-lg bg-rose-50 p-1 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <datalist id="msgate-nav-paths">
                {["/shop", "/about", "/contact", "/shipping-policy", "/refund-policy", "/terms", "/privacy-policy", "/legal-notice", ...(draft.pages ?? []).map((page) => `/${page.slug}`)].map((path) => (
                  <option key={path} value={path} />
                ))}
              </datalist>
              <button type="button" onClick={addNav} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold dark:bg-slate-800">
                <Plus className="h-3 w-3" />
                Lien
              </button>
            </div>
          </Section>

          {/* Pages ajoutées : reprises d'une adresse, ou écrites ici */}
          <Section title="Pages" right={<span className="text-[10px] text-slate-400">dans le menu, entre About et Shipping</span>}>
            <p className="mb-2 text-[11px] text-slate-500">
              Colle l&apos;adresse d&apos;une page d&apos;un autre site : son contenu arrive sans le header ni le footer, rendu avec les tiens, et tout se
              modifie dans l&apos;aperçu.
            </p>
            <div className="flex gap-1.5">
              <input
                value={pageUrl}
                onChange={(e) => setPageUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void importPageFromUrl()}
                placeholder="https://autre-site.com/pages/faq"
                className={field}
              />
              <button
                type="button"
                onClick={() => void importPageFromUrl()}
                disabled={busy === "page-import" || !pageUrl.trim()}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-3 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
              >
                {busy === "page-import" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                Copier la page
              </button>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={pageTitle}
                onChange={(e) => setPageTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addBlankPage()}
                placeholder="Ou le titre d'une page vide (FAQ, How it works…)"
                className={field}
              />
              <button
                type="button"
                onClick={addBlankPage}
                disabled={!pageTitle.trim()}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-slate-100 px-3 text-[12px] font-medium text-slate-700 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
              >
                <Plus className="h-3.5 w-3.5" />
                Créer
              </button>
            </div>
            {draft.pages?.length ? (
              <ul className="mt-2.5 space-y-1">
                {draft.pages.map((page) => (
                  <li key={page.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[12px] dark:bg-slate-800/60">
                    <button type="button" onClick={() => showPage(page)} className="min-w-0 flex-1 truncate text-left font-medium hover:underline" title="Ouvrir dans l'aperçu">
                      {page.title}
                    </button>
                    <code className="hidden shrink-0 text-[10px] text-slate-400 sm:inline">/{page.slug}</code>
                    <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
                      <input type="checkbox" checked={page.inNav} onChange={(e) => patchPage(page.id, { inNav: e.target.checked })} />
                      menu
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const has = page.blocks.some((block) => block.type === "form");
                        patchPage(page.id, { blocks: has ? page.blocks.filter((block) => block.type !== "form") : [...page.blocks, { type: "form" }] });
                        showPage(page);
                      }}
                      title={page.blocks.some((block) => block.type === "form") ? "Retirer le formulaire de contact de cette page" : "Ajouter le formulaire de contact en bas de cette page"}
                      className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium", page.blocks.some((block) => block.type === "form") ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-white text-slate-600 ring-1 ring-slate-900/[0.06] dark:bg-slate-900 dark:text-slate-300")}
                    >
                      Formulaire
                    </button>
                    <button type="button" onClick={() => removePage(page.id)} title="Supprimer la page" className="shrink-0 rounded-md p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          {/* Entité légale */}
          <Section title="Entité légale — reprise telle quelle dans le footer et les politiques">
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDropping(false);
                void readLlcDocument(event.dataTransfer.files);
              }}
              className={cn(
                "mb-2.5 flex h-16 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed text-[11px] transition",
                dropping
                  ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30"
                  : "border-slate-300 text-slate-500 dark:border-slate-700"
              )}
            >
              {busy === "llc" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {busy === "llc"
                ? "Lecture du document…"
                : "Glisse tous les documents de la LLC d'un coup (PDF ou .txt)"}
              <input
                type="file"
                accept=".pdf,.txt,text/plain,application/pdf"
                className="hidden"
                multiple
                onChange={(event) => void readLlcDocument(event.target.files)}
              />
            </label>
            {llcFiles.length ? (
              <div className="mb-2 space-y-1">
                {llcFiles.map((entry) => (
                  <div
                    key={entry.fileName}
                    className="flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] dark:bg-slate-800/60"
                  >
                    <span className={cn("mt-0.5 shrink-0", entry.reason === "ok" ? "text-emerald-600" : "text-amber-600")}>
                      {entry.reason === "ok" ? <Check className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{entry.fileName}</span>
                      <span className="block text-slate-400">
                        {entry.reason === "ok"
                          ? `${entry.chars.toLocaleString("fr-FR")} caractères lus`
                          : entry.hint || entry.reason}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {llcNote ? <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">{llcNote}</p> : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <Labelled text="Raison sociale (LLC)">
                <input value={draft.legalName} onChange={(e) => patchDraft({ legalName: e.target.value })} placeholder="BLASTUP GLOW LLC" className={field} />
              </Labelled>
              <Labelled text="État d'immatriculation">
                <input value={draft.stateOfIncorporation} onChange={(e) => patchDraft({ stateOfIncorporation: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Adresse">
                <input value={draft.addressLine} onChange={(e) => patchDraft({ addressLine: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Ville">
                <input value={draft.city} onChange={(e) => patchDraft({ city: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="État">
                <input value={draft.region} onChange={(e) => patchDraft({ region: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Code postal">
                <input value={draft.postalCode} onChange={(e) => patchDraft({ postalCode: e.target.value })} className={field} />
              </Labelled>
            </div>
          </Section>

          {/* Support + paiement */}
          <Section title="Support & paiement">
            <div className="grid gap-2 sm:grid-cols-2">
              <Labelled text="E-mail de support">
                <input value={draft.supportEmail} onChange={(e) => patchDraft({ supportEmail: e.target.value })} placeholder="support@brand.com" className={field} />
              </Labelled>
              <Labelled text="Téléphone US">
                <input value={draft.supportPhone} onChange={(e) => patchDraft({ supportPhone: e.target.value })} placeholder="+1 (941) 396-6088" className={field} />
              </Labelled>
              <Labelled text="Horaires">
                <input value={draft.supportHours} onChange={(e) => patchDraft({ supportHours: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Descripteur de facturation">
                <input value={draft.billingDescriptor} onChange={(e) => patchDraft({ billingDescriptor: e.target.value.toUpperCase() })} placeholder="COLLAGENBLAST" className={field} />
              </Labelled>
            </div>
            {/* Le formulaire de contact : sur la page Contact par défaut, et sur n'importe quelle page ajoutée. */}
            <label className="mt-3 flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={draft.contactForm !== false} onChange={(e) => patchDraft({ contactForm: e.target.checked })} />
              Formulaire de contact sur la page Contact
              <button type="button" onClick={() => setOpenPath({ path: "/contact", nonce: Date.now() })} className="ml-auto text-[11px] text-slate-500 underline-offset-2 hover:underline">
                Voir la page Contact
              </button>
            </label>
            <p className="mt-1 text-[11px] text-slate-400">
              Les messages envoyés arrivent ici, pas par e-mail. Pour poser le formulaire sur une autre page, utilise le bouton « Formulaire » de la page dans la carte Pages.
            </p>
            <MessagesInbox slug={draft.slug} />
          </Section>

          {/* Livraison / retours */}
          <Section title="Livraison & retours">
            <div className="grid gap-2 sm:grid-cols-3">
              <Labelled text="Préparation (j. ouvrés)">
                <input type="number" min={0} value={draft.handlingTimeDays} onChange={(e) => patchDraft({ handlingTimeDays: Number(e.target.value) })} className={field} />
              </Labelled>
              <Labelled text="Livraison min">
                <input type="number" min={1} value={draft.deliveryMinDays} onChange={(e) => patchDraft({ deliveryMinDays: Number(e.target.value) })} className={field} />
              </Labelled>
              <Labelled text="Livraison max">
                <input type="number" min={1} value={draft.deliveryMaxDays} onChange={(e) => patchDraft({ deliveryMaxDays: Number(e.target.value) })} className={field} />
              </Labelled>
              <Labelled text="Expédié depuis">
                <input value={draft.shipsFrom} onChange={(e) => patchDraft({ shipsFrom: e.target.value })} className={field} />
              </Labelled>
              <Labelled text="Retours (jours)">
                <input type="number" min={0} value={draft.returnWindowDays} onChange={(e) => patchDraft({ returnWindowDays: Number(e.target.value) })} className={field} />
              </Labelled>
              <Labelled text="Franco de port ($)">
                <input type="number" min={0} value={draft.freeShippingThreshold} onChange={(e) => patchDraft({ freeShippingThreshold: Number(e.target.value) })} className={field} />
              </Labelled>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              Ces délais s&apos;affichent dans la Shipping Policy et sur chaque fiche produit. Mets ce que tu tiens
              réellement : un écart entre le délai affiché et le délai réel revient en chargebacks « item not received »,
              et c&apos;est ce motif qui fait perdre le MID après l&apos;avoir obtenu.
            </p>
          </Section>

          {/* Visuels proposés : rien ne se pose sur le site sans ton accord. */}
          {mediaProposals.length ? (
            <Section title={`Visuels à valider (${mediaProposals.length})`}>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
                Chaque image attend sa place sur le site. Garde ce qui te va, jette le reste : relancer
                « Visuels du site » en refait autant qu&apos;il en faut. Rien n&apos;est perdu tant que tu
                n&apos;as pas enregistré.
              </p>
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyMedia(mediaProposals)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white dark:bg-white dark:text-slate-900"
                >
                  <Check className="h-3.5 w-3.5" />
                  Tout garder
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMediaProposals([]);
                    toast.success("Propositions écartées");
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Tout jeter
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {mediaProposals.map((item) => (
                  <figure
                    key={item.key + item.url}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  >
                    <button
                      type="button"
                      onClick={() => setZoomPack(item.url)}
                      className="block w-full"
                      title="Voir en grand"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.url} alt="" className="aspect-[4/3] w-full object-cover" />
                    </button>
                    <figcaption className="flex items-center justify-between gap-1 px-2 py-1.5">
                      <span className="truncate text-[11px] font-medium text-slate-500">
                        {mediaSlotLabel(item.key)}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => applyMedia([item])}
                          title="Poser sur le site"
                          className="rounded-md bg-emerald-50 p-1 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMediaProposals((current) =>
                              current.filter((entry) => entry.key + entry.url !== item.key + item.url)
                            )
                          }
                          title="Jeter"
                          className="rounded-md bg-rose-50 p-1 text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Les visuels déjà posés, pour les juger et les retirer.

              Sans cette vue, la seule façon de se débarrasser d'une image ratée
              était de relancer toute la fournée en espérant mieux. Ici on voit
              ce qui est en ligne, et on enlève ce qui ne va pas — la place
              redevient libre pour la génération suivante. */}
          {draft.heroImageUrl ||
          draft.categories.some((category) => category.imageUrl) ||
          (draft.lifestyleUrls || []).length ? (
            <Section title="Visuels en ligne">
              <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
                Clique pour agrandir, la croix pour retirer. Une place vide se
                reremplit au prochain « Visuels du site ». Pense à enregistrer.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {draft.heroImageUrl ? (
                  <LiveMedia
                    url={draft.heroImageUrl}
                    label="Bannière"
                    onZoom={() => setZoomPack(draft.heroImageUrl!)}
                    onRemove={() => patchDraft({ heroImageUrl: "" })}
                    onRedo={() =>
                      setImageTarget({
                        label: "Bannière d'accueil",
                        current: draft.heroImageUrl,
                        apply: (url) => patchDraft({ heroImageUrl: url }),
                      })
                    }
                  />
                ) : null}
                {draft.categories
                  .filter((category) => category.imageUrl)
                  .map((category) => (
                    <LiveMedia
                      key={category.id}
                      url={category.imageUrl!}
                      label={category.label}
                      onZoom={() => setZoomPack(category.imageUrl!)}
                      onRemove={() =>
                        patchDraft({
                          categories: draft.categories.map((entry) =>
                            entry.id === category.id ? { ...entry, imageUrl: "" } : entry
                          ),
                        })
                      }
                      onRedo={() =>
                        setImageTarget({
                          label: `Catégorie · ${category.label}`,
                          current: category.imageUrl,
                          apply: (url) =>
                            patchDraft({
                              categories: draft.categories.map((entry) =>
                                entry.id === category.id ? { ...entry, imageUrl: url } : entry
                              ),
                            }),
                        })
                      }
                    />
                  ))}
                {(draft.lifestyleUrls || []).map((url, index) => (
                  <LiveMedia
                    key={url}
                    url={url}
                    label={`Ambiance ${index + 1}`}
                    onZoom={() => setZoomPack(url)}
                    onRemove={() =>
                      patchDraft({
                        lifestyleUrls: (draft.lifestyleUrls || []).filter((entry) => entry !== url),
                      })
                    }
                    onRedo={() =>
                      setImageTarget({
                        label: `Ambiance ${index + 1}`,
                        current: url,
                        apply: (next) =>
                          patchDraft({
                            lifestyleUrls: (draft.lifestyleUrls || []).map((entry) =>
                              entry === url ? next : entry
                            ),
                          }),
                      })
                    }
                  />
                ))}
              </div>
            </Section>
          ) : null}

          {/* Mise en page : l'ordre, le cadrage, l'espacement, et de quoi
              ajouter ce que le modele copie n'avait pas. */}
          <Section title="Mise en page de l&apos;accueil">
            <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
              L&apos;ordre vient du site copie. Reordonne avec les fleches, masque ce que tu ne veux pas,
              change le cadrage et l&apos;espacement. Un bloc vide ne s&apos;affiche pas.
            </p>

            <div className="space-y-2">
              {sections.map((section, index) => (
                <div
                  key={section.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", String(index));
                    event.dataTransfer.effectAllowed = "move";
                    setDragging(index);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (dragOver !== index) setDragOver(index);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropSection(Number(event.dataTransfer.getData("text/plain")), index);
                    setDragging(null);
                    setDragOver(null);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDragOver(null);
                  }}
                  className={cn(
                    "cursor-grab rounded-xl border p-2.5 transition active:cursor-grabbing",
                    dragging === index && "opacity-40",
                    dragOver === index && dragging !== index && "ring-2 ring-slate-900 dark:ring-white",
                    section.hidden
                      ? "border-dashed border-slate-200 bg-slate-50/60 opacity-60 dark:border-slate-700 dark:bg-slate-800/40"
                      : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      title="Glisse pour réordonner"
                      className="shrink-0 select-none px-0.5 text-[13px] leading-none text-slate-300 dark:text-slate-600"
                    >
                      ⠿
                    </span>
                    <span className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        onClick={() => moveSection(index, -1)}
                        disabled={index === 0}
                        title="Monter"
                        className="h-4 rounded px-1 text-[10px] leading-none text-slate-500 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-slate-800"
                      >
                        &#9650;
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSection(index, 1)}
                        disabled={index === sections.length - 1}
                        title="Descendre"
                        className="h-4 rounded px-1 text-[10px] leading-none text-slate-500 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-slate-800"
                      >
                        &#9660;
                      </button>
                    </span>

                    <button
                      type="button"
                      onClick={() => toggleSection(section.id)}
                      title={isSectionOpen(section.id) ? "Replier les réglages" : "Déplier les réglages"}
                      className="flex w-40 shrink-0 items-center gap-1 truncate text-left text-[12px] font-semibold"
                    >
                      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", !isSectionOpen(section.id) && "-rotate-90")} />
                      <span className="truncate">{BLOCK_LABELS[section.block]}</span>
                    </button>

                    <input
                      value={section.title ?? ""}
                      onChange={(event) => editSection(section.id, { title: event.target.value })}
                      placeholder={
                        section.block === "text" || section.block === "image" ? "Titre du bloc" : "Titre par defaut"
                      }
                      className={cn(field, "min-w-0 flex-1")}
                    />

                    {isSectionOpen(section.id) ? (
                      <>
                        <select
                          value={section.align ?? "left"}
                          onChange={(event) =>
                            editSection(section.id, { align: event.target.value as EcomSection["align"] })
                          }
                          className={cn(field, "w-24 shrink-0")}
                          title="Cadrage"
                        >
                          <option value="left">Aligne</option>
                          <option value="center">Centre</option>
                        </select>

                        <select
                          value={section.space ?? "normal"}
                          onChange={(event) =>
                            editSection(section.id, { space: event.target.value as EcomSection["space"] })
                          }
                          className={cn(field, "w-24 shrink-0")}
                          title="Espacement vertical"
                        >
                          <option value="tight">Serre</option>
                          <option value="normal">Normal</option>
                          <option value="airy">Aere</option>
                        </select>
                      </>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => editSection(section.id, { hidden: !section.hidden })}
                      title={section.hidden ? "Reafficher" : "Masquer"}
                      className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold dark:bg-slate-800"
                    >
                      {section.hidden ? "Afficher" : "Masquer"}
                    </button>

                    {section.block === "text" || section.block === "image" ? (
                      <button
                        type="button"
                        onClick={() => patchSections(sections.filter((entry) => entry.id !== section.id))}
                        title="Supprimer ce bloc"
                        className="shrink-0 rounded-lg bg-rose-50 p-1 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>

                  {!isSectionOpen(section.id) ? null : (
                  <>
                  {/* La réassurance porte ses cartes ici : c'est le bloc qu'on
                      retouche le plus vite d'une marque à l'autre. */}
                  {section.block === "assurances" ? (
                    <div className="mt-2 space-y-1.5">
                      {assuranceItems(draft, section).map((item, itemIndex) => (
                        <div key={itemIndex} className="flex items-center gap-2">
                          <input
                            value={item.title}
                            onChange={(event) => editAssurance(section, itemIndex, { title: event.target.value })}
                            placeholder="Free US shipping"
                            className={cn(field, "w-44 shrink-0 font-semibold")}
                          />
                          <input
                            value={item.body}
                            onChange={(event) => editAssurance(section, itemIndex, { body: event.target.value })}
                            placeholder="Ce que ca promet, en une phrase"
                            className={cn(field, "min-w-0 flex-1")}
                          />
                          <button
                            type="button"
                            onClick={() => removeAssurance(section, itemIndex)}
                            title="Supprimer cette carte"
                            className="shrink-0 rounded-lg bg-rose-50 p-1 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addAssurance(section)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Ajouter une carte
                      </button>
                    </div>
                  ) : null}

                  {/* Les blocs libres portent leur contenu ici meme. */}
                  {section.block === "text" ? (
                    <textarea
                      value={section.body ?? ""}
                      onChange={(event) => editSection(section.id, { body: event.target.value })}
                      rows={3}
                      placeholder="Ton texte. Une ligne vide separe deux paragraphes."
                      className={cn(field, "mt-2 h-auto w-full py-2 leading-relaxed")}
                    />
                  ) : null}

                  {section.block === "image" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        value={section.imageUrl ?? ""}
                        onChange={(event) => editSection(section.id, { imageUrl: event.target.value })}
                        placeholder="Colle l&apos;adresse d&apos;une image"
                        className={cn(field, "min-w-0 flex-1")}
                      />
                      {/* Reutiliser un visuel deja genere plutot qu&apos;en chercher un. */}
                      {(draft.lifestyleUrls || []).slice(0, 4).map((url) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => editSection(section.id, { imageUrl: url })}
                          title="Utiliser ce visuel"
                          className="h-9 w-12 shrink-0 overflow-hidden rounded-md border border-slate-200 dark:border-slate-700"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                      {section.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={section.imageUrl}
                          alt=""
                          className="h-9 w-12 shrink-0 rounded-md object-cover ring-2 ring-emerald-400"
                        />
                      ) : null}
                      {/* Décrire l'image plutôt que d'aller en chercher une. */}
                      <button
                        type="button"
                        onClick={() =>
                          setImageTarget({
                            label: section.title || "Bloc image",
                            current: section.imageUrl || undefined,
                            apply: (url) => editSection(section.id, { imageUrl: url }),
                          })
                        }
                        title="Créer cette image avec une consigne"
                        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-2.5 text-[11px] font-semibold text-white dark:bg-white dark:text-slate-900"
                      >
                        <Sparkles className="h-3 w-3" />
                        IA
                      </button>
                    </div>
                  ) : null}
                  </>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-400">Ajouter un bloc</span>
              <button
                type="button"
                onClick={() => addSection("text")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Texte
              </button>
              <button
                type="button"
                onClick={() => addSection("image")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Image
              </button>
              <a
                href={`/s/${draft.slug}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white dark:bg-white dark:text-slate-900"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Voir la page
              </a>
            </div>
          </Section>

          {/* Pied de page.

              Il portait tout ce que la souscription recoupe, et rien d'autre :
              les politiques, trois liens de boutique, trois cartes de paiement.
              Ce qui se recoupe reste deduit — le bloc contact ne se retape pas,
              il se retire. Le reste s'ecrit. */}
          <Section title="Pied de page">
            <div className="space-y-3">
              <Labelled text="Phrase d&apos;identite">
                <textarea
                  value={draft.footer?.legalLine ?? ""}
                  onChange={(event) => patchFooter({ legalLine: event.target.value })}
                  rows={2}
                  placeholder={defaultLegalLine(draft) || "Brand is owned and operated by…"}
                  className={cn(area, "leading-relaxed")}
                />
              </Labelled>

              {/* Les colonnes de liens. */}
              <div className="space-y-2">
                <span className={label}>Colonnes de liens</span>
                {footerCols.map((column, index) => (
                  <div key={index} className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <input
                        value={column.title}
                        onChange={(event) => editFooterColumn(index, { title: event.target.value })}
                        placeholder="Titre de la colonne"
                        className={cn(field, "min-w-0 flex-1 font-semibold")}
                      />
                      <button
                        type="button"
                        onClick={() => patchFooter({ columns: footerCols.filter((_, i) => i !== index) })}
                        title="Supprimer cette colonne"
                        className="shrink-0 rounded-lg bg-rose-50 p-1 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Le bloc de prose d'une colonne — le « About » du bas de page. */}
                    {typeof column.body === "string" ? (
                      <textarea
                        value={column.body}
                        onChange={(event) => editFooterColumn(index, { body: event.target.value })}
                        rows={4}
                        placeholder="Qui on est, ce qu&apos;on vend, ce qui se passe apres la commande."
                        className={cn(area, "mt-2 leading-relaxed")}
                      />
                    ) : null}

                    <div className="mt-2 space-y-1.5">
                      {column.links.map((link, linkIndex) => (
                        <div key={linkIndex} className="flex items-center gap-2">
                          <input
                            value={link.label}
                            onChange={(event) => editFooterLink(index, linkIndex, { label: event.target.value })}
                            placeholder="Suivre ma commande"
                            className={cn(field, "w-40 shrink-0")}
                          />
                          <input
                            value={link.href}
                            onChange={(event) => editFooterLink(index, linkIndex, { href: event.target.value })}
                            placeholder="/contact — ou https://instagram.com/…"
                            className={cn(field, "min-w-0 flex-1 font-mono text-[11px]")}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              editFooterColumn(index, { links: column.links.filter((_, i) => i !== linkIndex) })
                            }
                            title="Supprimer ce lien"
                            className="shrink-0 rounded-lg bg-rose-50 p-1 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => editFooterColumn(index, { links: [...column.links, { label: "", href: "" }] })}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Ajouter un lien
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            editFooterColumn(index, { body: typeof column.body === "string" ? undefined : "" })
                          }
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800"
                        >
                          {typeof column.body === "string" ? (
                            <>
                              <X className="h-3.5 w-3.5" />
                              Retirer le texte
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5" />
                              Texte
                            </>
                          )}
                        </button>
                        {/* Ecrire ce paragraphe a partir de la boutique. */}
                        <button
                          type="button"
                          onClick={() => void writeFooterColumn(index)}
                          disabled={footerBusy !== null}
                          title="Ecrire ce texte a partir de la marque, du catalogue et des delais"
                          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
                        >
                          {footerBusy === index ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          IA
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => patchFooter({ columns: [...footerCols, { title: "", links: [] }] })}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Ajouter une colonne
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      patchFooter({ columns: [...footerCols, { title: "About", body: "", links: [] }] })
                    }
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Colonne de texte
                  </button>
                  {/* Revenir aux colonnes deduites, quand on s'est perdu. */}
                  {draft.footer?.columns ? (
                    <button
                      type="button"
                      onClick={() => patchFooter({ columns: undefined })}
                      className="inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Revenir aux colonnes d&apos;origine
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => patchFooter({ hideContact: !draft.footer?.hideContact })}
                    className="ml-auto inline-flex h-8 items-center rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800"
                  >
                    {draft.footer?.hideContact ? "Afficher le bloc contact" : "Masquer le bloc contact"}
                  </button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Labelled text="Moyens de paiement (separes par des virgules)">
                  <input
                    value={footerPayments(draft).join(", ")}
                    onChange={(event) =>
                      patchFooter({
                        payments: event.target.value
                          .split(",")
                          .map((entry) => entry.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="VISA, MASTERCARD, AMEX"
                    className={field}
                  />
                </Labelled>
                <Labelled text="Ligne de copyright">
                  <input
                    value={draft.footer?.copyright ?? ""}
                    onChange={(event) => patchFooter({ copyright: event.target.value })}
                    placeholder={defaultCopyright(draft, new Date().getFullYear())}
                    className={field}
                  />
                </Labelled>
              </div>

              <Labelled text="Dernier mot (sous le copyright)">
                <textarea
                  value={draft.footer?.note ?? ""}
                  onChange={(event) => patchFooter({ note: event.target.value })}
                  rows={2}
                  placeholder="Ce qu&apos;on veut ajouter tout en bas."
                  className={cn(area, "leading-relaxed")}
                />
              </Labelled>
            </div>
          </Section>

          {/* Catalogue */}
          <Section title="Catalogue">
            <div className="flex flex-wrap items-end gap-2">
              <Labelled text="Niche / catégorie">
                <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="collagen beauty supplements" className={cn(field, "w-56")} />
              </Labelled>
              {/* Plus de compteur de produits : le catalogue vient du site
                  copié, on le taille ensuite en supprimant ce qu'on ne veut
                  pas. Un nombre demandé d'avance ne voulait rien dire. */}
              <button
                type="button"
                onClick={() => void generateCopy()}
                disabled={busy === "copy"}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
              >
                {busy === "copy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Réécrire les textes
              </button>
              <span className="text-[11px] text-slate-400">
                (accroches, arguments, descriptions — par l&apos;IA)
              </span>
              {/* La page « à propos ».

                  C'est l'une des premières qu'un analyste de souscription
                  ouvre, et son absence se remarque. Le texte reste
                  positionnel : pas de fondateur nommé, pas d'année de création,
                  pas de certification — rien qui puisse être vérifié et démenti. */}
              <button
                type="button"
                onClick={() => void generateAbout()}
                disabled={busy === "about"}
                title="Histoire de marque + photo d'atelier, sans aucun fait vérifiable inventé"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold disabled:opacity-50 dark:bg-slate-800"
              >
                {busy === "about" || aboutRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {draft.aboutStory?.paragraphs?.length ? "Refaire l'à-propos" : "Générer l'à-propos"}
              </button>
              <button
                type="button"
                onClick={() => void generatePackaging()}
                disabled={busy === "packaging" || !draft.products.length}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold disabled:opacity-50 dark:bg-slate-800"
              >
                {busy === "packaging" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                Générer les packagings
              </button>

              <button
                type="button"
                onClick={() => void generateMedia(draft.id)}
                /* Sans pack brandé, il n'y a rien de la marque à mettre dans la
                   scène : le bouton reste fermé plutôt que de produire des
                   images à jeter. */
                disabled={
                  busy === "media" ||
                  !draft.products.some((p) => p.imageUrl && p.imageUrl !== p.sourceImageUrl)
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold disabled:opacity-50 dark:bg-slate-800"
              >
                {busy === "media" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" />
                )}
                {draft.products.some((p) => p.imageUrl && p.imageUrl !== p.sourceImageUrl)
                  ? "Visuels du site (avec tes produits)"
                  : "Visuels — fais les packagings d'abord"}
              </button>

              {/* Les doublons se voient à l'œil sur sept lignes, pas sur vingt.
                  Un compteur et un bouton valent mieux qu'un long tri manuel. */}
              {duplicateHandles.length ? (
                <button
                  type="button"
                  onClick={() => {
                    patchDraft({
                      products: draft.products.filter(
                        (product) => !duplicateHandles.includes(product.handle)
                      ),
                    });
                    toast.success(`${duplicateHandles.length} doublon(s) retirés — pense à enregistrer`);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Retirer {duplicateHandles.length} doublon(s)
                </button>
              ) : null}

              <button
                type="button"
                onClick={() =>
                  setPickedProducts(
                    pickedProducts.length === draft.products.length
                      ? []
                      : draft.products.map((product) => product.handle)
                  )
                }
                className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold dark:bg-slate-800"
              >
                {pickedProducts.length === draft.products.length
                  ? "Tout désélectionner"
                  : "Tout sélectionner"}
              </button>

              {/* Sélectionner par le nom : sur un catalogue où une gamme entière
                  se distingue par un mot — « VIP », « Bundle », une contenance —
                  c'est plus rapide que vingt cases à cocher. */}
              <div className="inline-flex items-center gap-1">
                <input
                  value={pickFilter}
                  onChange={(event) => setPickFilter(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const needle = pickFilter.trim().toLowerCase();
                    if (!needle) return;
                    const hits = draft.products
                      .filter((product) => product.name.toLowerCase().includes(needle))
                      .map((product) => product.handle);
                    setPickedProducts(hits);
                    toast.success(`${hits.length} produit(s) contenant « ${pickFilter.trim()} »`);
                  }}
                  placeholder="Sélectionner par nom — ex. VIP"
                  className={cn(field, "w-52")}
                />
              </div>

              {pickedProducts.length ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  {pickedProducts.length} sélectionné(s) — les actions ne portent que sur eux
                  <button
                    type="button"
                    onClick={() => setPickedProducts([])}
                    className="font-semibold underline"
                  >
                    tout
                  </button>
                </span>
              ) : null}

              {draft.products.some((p) => p.imageUrl && p.imageUrl === p.sourceImageUrl) ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  <TriangleAlert className="h-3 w-3" />
                  {draft.products.filter((p) => p.imageUrl === p.sourceImageUrl).length} photo(s) encore
                  au modèle — charge ton logo
                </span>
              ) : null}

              {mediaLeft ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {mediaLeft} visuel(s) en cours
                </span>
              ) : null}

              {/* Un packaging met une à deux minutes : sans compteur, on ne sait
                  pas si ça travaille ou si c'est mort. */}
              {pendingPackaging ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {draft.products.length - pendingPackaging}/{draft.products.length} prêts · ça tourne
                </span>
              ) : null}
            </div>

            {draft.products.length ? (
              <div className="mt-3 space-y-1.5">
                {draft.products.map((product, index) => (
                  <div
                    key={product.handle}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg p-2",
                      // Un doublon se repère à la ligne, pas dans un compteur :
                      // c'est celle-là qu'on veut supprimer, et il faut la voir.
                      duplicateHandles.includes(product.handle)
                        ? "bg-rose-50 ring-1 ring-rose-300 dark:bg-rose-500/10 dark:ring-rose-500/40"
                        : "bg-slate-50 dark:bg-slate-800/60"
                    )}
                  >
                    {product.imageUrl ? (
                      // Cliquable : un packaging se juge en grand, pas en 40 px.
                      <button
                        type="button"
                        onClick={() => setZoomPack(product.imageUrl)}
                        title="Voir en grand"
                        className="h-10 w-10 shrink-0 overflow-hidden rounded hover:opacity-80"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                      </button>
                    ) : (
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded bg-slate-200 dark:bg-slate-700">
                        {product.packagingTaskId ? (
                          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                        ) : (
                          <span className="text-[9px] text-slate-500">—</span>
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                        <span className="min-w-0 truncate">{product.name}</span>
                        {duplicateHandles.includes(product.handle) ? (
                          <span className="shrink-0 rounded bg-rose-600 px-1 text-[9px] font-bold uppercase text-white">
                            doublon
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">{product.subtitle}</p>
                    </div>
                    <select
                      value={product.price}
                      onChange={(e) => {
                        const price = Number(e.target.value);
                        patchDraft({
                          products: draft.products.map((item, i) => (i === index ? { ...item, price } : item)),
                        });
                      }}
                      className="h-7 rounded-md bg-white px-1.5 text-[11px] dark:bg-slate-900"
                    >
                      {PRICE_POINTS.map((price) => (
                        <option key={price} value={price}>${price}</option>
                      ))}
                    </select>
                    <input
                      type="checkbox"
                      checked={pickedProducts.includes(product.handle)}
                      onChange={() =>
                        setPickedProducts((current) =>
                          current.includes(product.handle)
                            ? current.filter((handle) => handle !== product.handle)
                            : [...current, product.handle]
                        )
                      }
                      title="Sélectionner pour les actions"
                      className="shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => patchDraft({ products: draft.products.filter((_, i) => i !== index) })}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-[12px] text-slate-400">Aucun produit. Génère la copy pour remplir le catalogue.</p>
            )}

            {/* Compléter un catalogue existant, sans repartir d'une copie : pour
                atteindre les quatre produits de la checklist, ou piocher une
                gamme ailleurs. */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <span className={label}>Ajouter depuis un site</span>
              <input
                value={addFrom}
                onChange={(event) => setAddFrom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addProductsFrom(addFrom);
                }}
                placeholder="autreboutique.com"
                className={cn(field, "w-52")}
              />
              <button
                type="button"
                onClick={() => void addProductsFrom(addFrom)}
                disabled={busy === "add-products" || !addFrom.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold disabled:opacity-50 dark:bg-slate-800"
              >
                {busy === "add-products" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Ajouter
              </button>
              <p className="min-w-0 flex-1 text-[11px] text-slate-400">
                Produits repris intacts. Leurs photos deviennent le gabarit de tes packagings.
              </p>
            </div>

            {/* Tes propres boutiques comme réserve de produits, et le produit écrit à la main. */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={label}>Ou depuis une de tes boutiques</span>
              <select value={addFromSite} onChange={(event) => setAddFromSite(event.target.value)} className={cn(field, "w-52")}>
                <option value="">Choisir une boutique</option>
                {sites
                  .filter((site) => site.id !== draft.id && site.products.length)
                  .map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.brandName} · {site.products.length} produits
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={() => addProductsFromSite(addFromSite)}
                disabled={!addFromSite}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold disabled:opacity-50 dark:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Reprendre les produits
              </button>
              <button
                type="button"
                onClick={addBlankProduct}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12px] font-semibold dark:bg-slate-800"
                title="Un produit vide, à remplir dans le catalogue ou dans l'aperçu"
              >
                <Plus className="h-3.5 w-3.5" />
                Produit vide
              </button>
            </div>
          </Section>

          {/* Mise en ligne */}
          <Section title="Mise en ligne">
            <div className="space-y-2">
              <DnsRow label="A" host="@" value={APEX_IP} />
              <DnsRow label="CNAME" host="www" value={WWW_CNAME} />
              <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-slate-500">
                <li>
                  Renseigne le <strong>Domaine</strong> dans Identité, exactement comme acheté (<code>{draft.domain || "marque.com"}</code>) : c&apos;est lui qui
                  fait le lien entre le nom et cette boutique.
                </li>
                <li>Déploie l&apos;outil sur Vercel (le dépôt GitHub) avec les mêmes variables que ton .env.local, Supabase compris : les boutiques y sont copiées à chaque enregistrement.</li>
                <li>
                  Sur le projet Vercel, Settings → Domains → ajoute <code>{draft.domain || "marque.com"}</code> et <code>www.{draft.domain || "marque.com"}</code>.
                </li>
                <li>Chez le registrar, pose les deux enregistrements ci-dessus. Le HTTPS est automatique une fois le DNS propagé (quelques minutes à quelques heures).</li>
                <li>Ouvre le domaine : la boutique s&apos;affiche à la racine, sans /s/… dans l&apos;adresse. Envoie ensuite l&apos;URL au processeur une fois la checklist au vert.</li>
              </ol>
            </div>
          </Section>

          {/* Checklist */}
          <Section
            title="Checklist underwriting"
            right={
              score ? (
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", score.ready ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                  {score.ok}/{score.total} · {score.fails} bloquant(s) · {score.warns} avertissement(s)
                </span>
              ) : null
            }
          >
            {/* Ce qui manque d'abord, et en clair : on ouvre cette liste pour
                savoir quoi remplir, pas pour relire ce qui est déjà bon. */}
            {checklist.some((item) => item.status !== "ok") ? (
              <div className="mb-2 rounded-xl bg-amber-50 p-2.5 dark:bg-amber-500/10">
                <p className="mb-1.5 text-[12px] font-semibold text-amber-800 dark:text-amber-300">
                  {checklist.filter((item) => item.status === "fail").length} bloquant(s) ·{" "}
                  {checklist.filter((item) => item.status === "warn").length} à vérifier
                </p>
                <div className="flex flex-wrap gap-1">
                  {checklist
                    .filter((item) => item.status !== "ok")
                    .map((item) => (
                      <span
                        key={item.id}
                        title={item.detail}
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                          item.status === "fail"
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
                        )}
                      >
                        {item.label}
                      </span>
                    ))}
                </div>
              </div>
            ) : (
              <p className="mb-2 rounded-xl bg-emerald-50 p-2.5 text-[12px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                Tous les champs sont remplis.
              </p>
            )}

            <p className="mb-2 text-[11px] text-slate-400">
              Enregistre pour rafraîchir. « OK » veut dire présent et cohérent, pas vérifié : l&apos;underwriter
              appelle le numéro et écrit à l&apos;adresse.
            </p>
            <div className="space-y-1">
              {[...checklist]
                .sort((a, b) => {
                  // Les manques remontent : c'est ce qu'on vient chercher.
                  const rank = { fail: 0, warn: 1, ok: 2 } as const;
                  return rank[a.status] - rank[b.status];
                })
                .map((item) => (
                <div key={item.id} className="flex gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
                  <span className={cn("mt-0.5 shrink-0", STATUS_STYLE[item.status])}>
                    {item.status === "ok" ? <Check className="h-3.5 w-3.5" /> : item.status === "warn" ? <TriangleAlert className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium">{item.label}</p>
                    <p className="text-[11px] text-slate-400">{item.detail}</p>
                  </div>
                  <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-slate-300">{item.group}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* ---------------- Colonne d'aperçu ---------------- */}
      {showPreview && draft ? (
        <div className="xl:sticky xl:top-4 xl:self-start">
          <LivePreview
            site={draft}
            dirty={JSON.stringify(draft) !== saved}
            selected={picked}
            onSelect={setPicked}
            onPickImage={(key, src) => setImageTarget(targetForImageKey(key, src))}
            onReorder={reorderSections}
            onEditText={(from, to) => {
              const result = applyTextEdit(draft, from, to);
              if (result.mode === "none") return false;
              setDraft(result.site);
              return true;
            }}
            openPath={openPath}
          />
        </div>
      ) : null}
      </div>

      {/* Suivi flottant.
          Copy, packagings et visuels tournent en parallèle et durent des
          minutes ; sans un endroit fixe qui les récapitule, on ne sait pas ce
          qui travaille ni quand on peut publier. */}
      {draft && (busy === "copy" || packRun || mediaRun || busy === "media" || busy === "about" || aboutRunning) ? (
        <div className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-[290px] rounded-2xl bg-slate-950/90 p-3.5 text-white shadow-2xl backdrop-blur-md sm:bottom-6 sm:right-6">
          <div className="mb-2.5 flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
              En cours
            </p>
            {/* Le chrono : deux minutes d'attente sans repère se vivent comme
                un blocage, et on reclique. */}
            <span className="text-[11px] font-semibold tabular-nums text-white/70">
              {Math.floor(runSeconds / 60)}:{String(runSeconds % 60).padStart(2, "0")}
            </span>
          </div>

          <div className="space-y-2.5">
            {busy === "copy" ? (
              <div className="flex items-center gap-2 text-[12px]">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                Textes de marque
              </div>
            ) : null}
            {packRun ? (
              <RunBar label="Packagings" done={packRun.done} total={packRun.total} />
            ) : null}
            {mediaRun ? (
              <RunBar label="Visuels du site" done={mediaRun.done} total={mediaRun.total} />
            ) : null}
            {busy === "about" || aboutRunning ? (
              <div className="flex items-center gap-2 text-[12px]">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                Page « à propos »
              </div>
            ) : null}
            {busy === "media" && !mediaRun ? (
              <div className="flex items-center gap-2 text-[12px]">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                Lancement des visuels
              </div>
            ) : null}
          </div>

          <p className="mt-2.5 text-[10px] leading-snug text-white/50">
            Tu peux continuer à travailler — publie quand tout est retombé.
          </p>
        </div>
      ) : null}

      {/* La fenêtre de retouche par consigne, quel que soit l'emplacement visé. */}
      {imageTarget && draft ? (
        <ImagePromptDialog site={draft} target={imageTarget} onClose={() => setImageTarget(null)} />
      ) : null}

      {zoomPack ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-slate-950/90 p-4"
          onClick={() => setZoomPack(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomPack}
            alt=""
            onClick={(event) => event.stopPropagation()}
            className="max-h-[80vh] w-auto rounded-xl shadow-2xl"
          />
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <a
              href={zoomPack}
              download
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-4 text-[12px] font-semibold text-slate-900"
            >
              Télécharger
            </a>
            <button
              type="button"
              onClick={() => setZoomPack(null)}
              className="h-9 rounded-lg px-3 text-[12px] font-medium text-slate-300 hover:text-white"
            >
              Fermer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function DnsRow({ label: kind, host, value }: { label: string; host: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] dark:bg-slate-800/60">
      <span className="w-14 font-bold">{kind}</span>
      <span className="w-10 text-slate-400">{host}</span>
      <code className="flex-1 font-mono">{value}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success("Copié");
        }}
        className="text-slate-400 hover:text-slate-900 dark:hover:text-white"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Une vignette de visuel posé : on l'agrandit, ou on la retire. */
function LiveMedia({
  url,
  label,
  onZoom,
  onRemove,
  onRedo,
}: {
  url: string;
  label: string;
  onZoom: () => void;
  onRemove: () => void;
  onRedo?: () => void;
}) {
  return (
    <figure className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <button type="button" onClick={onZoom} className="block w-full" title="Voir en grand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="aspect-[4/3] w-full object-cover" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        title="Retirer ce visuel"
        className="absolute right-1 top-1 rounded-md bg-white/90 p-1 text-rose-600 opacity-0 transition group-hover:opacity-100 dark:bg-slate-900/90 dark:text-rose-300"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <figcaption className="flex items-center gap-1 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-500">{label}</span>
        {onRedo ? (
          <button
            type="button"
            onClick={onRedo}
            title="Refaire cette image avec une consigne"
            className="shrink-0 rounded-md bg-slate-100 p-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            <Sparkles className="h-3 w-3" />
          </button>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * Rogne les marges vides d'un logo et le recentre.
 *
 * Un PNG exporté d'un outil de design arrive presque toujours avec une bordure
 * transparente, souvent asymétrique. Elle ne se voit pas dans un visualiseur,
 * mais partout où le logo est posé dans une hauteur fixe — l'en-tête, le
 * footer, la face d'un packaging — c'est elle qui occupe la place : le logo
 * paraît minuscule et décalé. On la retire une fois, au chargement, et tout ce
 * qui vient après reçoit un fichier propre et centré.
 *
 * Le fichier d'origine est rendu tel quel si quoi que ce soit échoue : mieux
 * vaut un logo mal cadré qu'un logo absent.
 */
async function trimLogo(dataUrl: string): Promise<string> {
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("image illisible"));
      element.src = dataUrl;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) return dataUrl;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0);

    const { data } = context.getImageData(0, 0, width, height);

    /*
     * Ce qui compte comme « vide ».
     *
     * Transparent, évidemment ; mais aussi le blanc plein, parce qu'un logo
     * exporté en JPEG n'a pas de canal alpha et arrive sur fond blanc.
     */
    const isBlank = (index: number) => {
      const alpha = data[index + 3];
      if (alpha < 12) return true;
      return data[index] > 247 && data[index + 1] > 247 && data[index + 2] > 247;
    };

    let top = height;
    let left = width;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (isBlank((y * width + x) * 4)) continue;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    if (right < left || bottom < top) return dataUrl;

    // Une marge fine évite que le tracé touche le bord une fois redimensionné.
    const pad = Math.round(Math.max(right - left, bottom - top) * 0.04);
    const cropX = Math.max(0, left - pad);
    const cropY = Math.max(0, top - pad);
    const cropW = Math.min(width - cropX, right - left + 1 + pad * 2);
    const cropH = Math.min(height - cropY, bottom - top + 1 + pad * 2);

    /*
     * On garde la forme du logo, on ne la force pas au carré.
     *
     * Un carré paraissait la solution propre, mais il ruine les logos en
     * largeur : posé dans une hauteur fixe, un bandeau de texte devenu carré
     * s'affiche à un quart de sa taille. Le cadre épouse le tracé — donc il est
     * centré par construction — et chaque emplacement en fait ce qu'il veut.
     */
    const out = document.createElement("canvas");
    out.width = cropW;
    out.height = cropH;
    const target = out.getContext("2d");
    if (!target) return dataUrl;
    target.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return out.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

/** Une fournée en cours : ce qui est fait, sur combien, et où ça en est. */
function RunBar({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-[12px]">
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-white/60">
          {done}/{total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-emerald-400 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
