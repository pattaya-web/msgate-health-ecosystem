"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Eye,
  FileSpreadsheet,
  Folder,
  HardDrive,
  Hash,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UploadProgress, type ProgressItem, type UploadProgressState } from "@/components/ads/upload-progress";
import { AdPreviewPanel, type PreviewCopy, type PreviewItem } from "@/components/ads/ad-preview-panel";
import {
  AD_NAME_TOKENS,
  formatAdName,
  CAROUSEL_ENHANCEMENTS,
  CTA_OPTIONS,
  IMAGE_ENHANCEMENTS,
  VIDEO_ENHANCEMENTS,
  parsePostIds,
  type PickerAd,
  type PickerAdset,
  type PickerCampaign,
  type UploadAccount,
  type UploadedMedia,
} from "@/lib/meta/uploader-shared";

const META_BLUE = "bg-[#1877F2] hover:bg-[#166fe5] text-white";

/** L'ad copy et les réglages d'envoi, gardés dans le navigateur : on les retrouve à la visite suivante. */
const SAVED_KEY = "msgate-uploader-copy";
type SavedCopy = {
  headlines: string[];
  bodies: string[];
  descriptions: string[];
  cta: string;
  websiteUrl: string;
  displayUrl: string;
  productUrl: string;
  namePattern: string;
};

type TextMode = "all" | "adset" | "ad";

/** Les textes propres à un ad set ou à une pub ; un champ vide reprend le texte commun. */
type OwnCopy = { headline: string; body: string; description: string };
const EMPTY_COPY: OwnCopy = { headline: "", body: "", description: "" };

/** Une clé stable par fichier, pour garder ses textes même si on en retire un autre. */
const fileKey = (file: File) => `f:${file.name}:${file.size}:${file.lastModified}`;

const MEDIA_EXT = /\.(jpe?g|png|webp|gif|mp4|mov|m4v|webm)$/i;

/** Garde les photos et vidéos que Meta accepte ; le reste est signalé. */
function keepMedia(list: File[]) {
  const ok = list.filter((file) => /^(image|video)\//.test(file.type) || MEDIA_EXT.test(file.name));
  const skipped = list.length - ok.length;
  if (skipped) toast.error(`${skipped} fichier${skipped > 1 ? "s" : ""} ignoré${skipped > 1 ? "s" : ""} : seulement JPG, PNG, WEBP, GIF, MP4, MOV, M4V`);
  return ok;
}

/** Une image glissée depuis un autre onglet arrive en lien : on la télécharge pour en faire un fichier. */
async function fileFromUrl(url: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  if (!/^(image|video)\//.test(blob.type)) throw new Error(blob.type);
  const base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image");
  const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  return new File([blob], MEDIA_EXT.test(base) ? base : `${base || "image"}.${ext}`, { type: blob.type });
}

export function MetaUploader() {
  const [accounts, setAccounts] = useState<UploadAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [campaigns, setCampaigns] = useState<PickerCampaign[]>([]);
  const [adsets, setAdsets] = useState<PickerAdset[]>([]);
  const [ads, setAds] = useState<PickerAd[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingTree, setLoadingTree] = useState(false);
  const [qCampaign, setQCampaign] = useState("");
  const [qAdset, setQAdset] = useState("");
  const [qAd, setQAd] = useState("");
  const [qAccount, setQAccount] = useState("");
  const [onlyActive, setOnlyActive] = useState({ campaign: true, adset: true, ad: true });
  const [campaignId, setCampaignId] = useState("");
  const [adsetId, setAdsetId] = useState("");
  const [adId, setAdId] = useState("");
  const [method, setMethod] = useState<"copy" | "xlsx">("copy");
  const [turbo, setTurbo] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  /** Les Post ID collés : chacun devient une pub qui reprend la publication existante. */
  const [postText, setPostText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [createNewCampaign, setCreateNewCampaign] = useState(false);
  const [multiCampaigns, setMultiCampaigns] = useState(false);
  const [createNewAdset, setCreateNewAdset] = useState(true);
  const [adsetPerUpload, setAdsetPerUpload] = useState(false);
  const [autoDivide, setAutoDivide] = useState(false);
  const [customAdset, setCustomAdset] = useState(false);
  const [useNamePattern, setUseNamePattern] = useState(true);
  const [namePattern, setNamePattern] = useState("{file}");
  const [textMode, setTextMode] = useState<TextMode>("all");
  /** Textes par ad set (« adset:<n> ») ou par pub (clé du fichier / « p:<post> »). */
  const [ownCopy, setOwnCopy] = useState<Record<string, OwnCopy>>({});
  /** La pub ouverte dans le panneau d'aperçu (index dans la liste des pubs). */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [flexible, setFlexible] = useState(true);
  const [headlines, setHeadlines] = useState(["", ""]);
  const [bodies, setBodies] = useState(["", "", "", "", ""]);
  const [descriptions, setDescriptions] = useState([""]);
  const [cta, setCta] = useState("SHOP_NOW");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [displayUrl, setDisplayUrl] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [enhancements, setEnhancements] = useState<Record<string, boolean>>({});
  const [aiGenerated, setAiGenerated] = useState(false);
  // Décochée par défaut : les pubs créées partent en live tout de suite (demande de Mady, 01/11/2026).
  const [paused, setPaused] = useState(false);
  const [startNumber, setStartNumber] = useState("1");
  const [busy, setBusy] = useState<string | null>(null);
  /** La fenêtre de suivi de l'envoi (en bas à droite). */
  const [progress, setProgress] = useState<UploadProgressState | null>(null);
  const [copyLoaded, setCopyLoaded] = useState(false);
  /** Budget / jour et nom du nouvel ad set, pré-remplis depuis l'ad set modèle. */
  const [budget, setBudget] = useState("");
  /** Taux devise du compte → dollar : l'équivalent en $ du budget, à titre indicatif. */
  const [fx, setFx] = useState<Record<string, number>>({});
  const [newAdsetName, setNewAdsetName] = useState("");
  /** Nom de la nouvelle campagne (« Create new campaign ») ; vide = « <modèle> · copy ». */
  const [newCampaignName, setNewCampaignName] = useState("");

  // L'ad copy de la dernière fois, relu au tick suivant (pas de setState synchrone dans l'effet).
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || "null") as Partial<SavedCopy> | null;
        if (saved) {
          if (saved.headlines?.length) setHeadlines(saved.headlines);
          if (saved.bodies?.length) setBodies(saved.bodies);
          if (saved.descriptions?.length) setDescriptions(saved.descriptions);
          if (saved.cta) setCta(saved.cta);
          if (saved.websiteUrl) setWebsiteUrl(saved.websiteUrl);
          if (saved.displayUrl) setDisplayUrl(saved.displayUrl);
          if (saved.productUrl) setProductUrl(saved.productUrl);
          if (saved.namePattern) setNamePattern(saved.namePattern);
        }
      } catch {
        // première visite
      }
      setCopyLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Chaque modification de l'ad copy est sauvegardée aussitôt.
  useEffect(() => {
    if (!copyLoaded) return;
    try {
      const saved: SavedCopy = { headlines, bodies, descriptions, cta, websiteUrl, displayUrl, productUrl, namePattern };
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch {
      // stockage refusé : sans gravité
    }
  }, [copyLoaded, headlines, bodies, descriptions, cta, websiteUrl, displayUrl, productUrl, namePattern]);

  const postIds = useMemo(() => parsePostIds(postText), [postText]);

  // Glisser-déposer sur toute la page, et Ctrl+V d'une image copiée.
  useEffect(() => {
    let depth = 0;
    const hasPayload = (event: DragEvent) => {
      const types = Array.from(event.dataTransfer?.types ?? []);
      return types.includes("Files") || types.includes("text/uri-list");
    };
    const onEnter = (event: DragEvent) => {
      if (!hasPayload(event)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasPayload(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event: DragEvent) => {
      if (!hasPayload(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasPayload(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      if (dropped.length) {
        const ok = keepMedia(dropped);
        if (ok.length) setFiles((cur) => [...cur, ...ok]);
        return;
      }
      const url = (event.dataTransfer?.getData("text/uri-list") || "").split(/\r?\n/).find((line) => /^https?:/.test(line));
      if (!url) return;
      void fileFromUrl(url)
        .then((file) => setFiles((cur) => [...cur, file]))
        .catch(() => toast.error("Ce site ne laisse pas récupérer l'image : enregistre-la puis glisse le fichier."));
    };
    const onPaste = (event: ClipboardEvent) => {
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (!pasted.length) return;
      event.preventDefault();
      const ok = keepMedia(pasted).map((file, i) =>
        // Une capture collée s'appelle toujours « image.png » : on la numérote.
        file.name === "image.png" ? new File([file], `capture-${Date.now()}-${i + 1}.png`, { type: file.type }) : file
      );
      if (ok.length) {
        setFiles((cur) => [...cur, ...ok]);
        toast.success(`${ok.length} image${ok.length > 1 ? "s" : ""} collée${ok.length > 1 ? "s" : ""}`);
      }
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  // Aperçus des fichiers glissés (images et vidéos), libérés quand la liste change.
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file), video: /^video\//.test(file.type) })), [files]);
  useEffect(() => () => previews.forEach((item) => URL.revokeObjectURL(item.url)), [previews]);

  /** Se calquer sur une pub existante : ses textes, son lien et son bouton remplissent le formulaire. */
  async function pickTemplateAd(id: string) {
    setAdId(id);
    if (!id) return;
    setBusy("template");
    try {
      const res = await fetch(`/api/meta/upload?adId=${encodeURIComponent(id)}`);
      const body = (await res.json()) as { copy?: { headlines: string[]; bodies: string[]; descriptions: string[]; websiteUrl: string; displayUrl: string; cta: string }; error?: string };
      if (!res.ok || !body.copy) throw new Error(body.error || "Textes de la pub illisibles");
      const copy = body.copy;
      if (copy.headlines.length) setHeadlines(copy.headlines);
      if (copy.bodies.length) setBodies(copy.bodies);
      if (copy.descriptions.length) setDescriptions(copy.descriptions);
      if (copy.websiteUrl) setWebsiteUrl(copy.websiteUrl);
      if (copy.displayUrl) setDisplayUrl(copy.displayUrl);
      if (copy.cta) setCta(copy.cta);
      toast.success("Textes, lien et bouton repris de la pub modèle");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Textes de la pub illisibles");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/meta/upload");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        setAccounts(body.accounts || []);
        setFx(body.fx || {});
        if (body.accounts?.[0]) setAccountId(body.accounts[0].id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Comptes Meta indisponibles");
      } finally {
        setLoadingAccounts(false);
      }
    })();
  }, []);

  async function loadTree(id: string, force = false) {
    if (!id) return;
    setLoadingTree(true);
    try {
      const res = await fetch(`/api/meta/upload?accountId=${encodeURIComponent(id)}${force ? "&refresh=1" : ""}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setCampaigns(body.campaigns || []);
      setAdsets(body.adsets || []);
      setAds(body.ads || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Tree Meta indisponible");
    } finally {
      setLoadingTree(false);
    }
  }

  // Chargement au tick suivant : pas de setState synchrone dans le corps de l'effet (règle du compilateur React).
  useEffect(() => {
    if (!accountId) return;
    const timer = setTimeout(() => void loadTree(accountId), 0);
    return () => clearTimeout(timer);
  }, [accountId]);

  const filteredAccounts = useMemo(() => {
    const q = qAccount.trim().toLowerCase();
    if (!q) return accounts;
    const digits = q.replace(/\D/g, "");
    return accounts.filter((account) => {
      const idDigits = `${account.accountId} ${account.id}`.replace(/\D/g, "");
      return (
        account.name.toLowerCase().includes(q) ||
        account.id.toLowerCase().includes(q) ||
        account.accountId.toLowerCase().includes(q) ||
        (digits.length >= 3 && idDigits.includes(digits))
      );
    });
  }, [accounts, qAccount]);
  const filteredCampaigns = campaigns.filter(
    (row) =>
      row.name.toLowerCase().includes(qCampaign.toLowerCase()) &&
      (!onlyActive.campaign || row.status === "ACTIVE")
  );
  const filteredAdsets = adsets.filter(
    (row) =>
      row.campaignId === campaignId &&
      row.name.toLowerCase().includes(qAdset.toLowerCase()) &&
      (!onlyActive.adset || row.status === "ACTIVE")
  );
  const filteredAds = ads.filter(
    (row) =>
      row.adsetId === adsetId &&
      row.name.toLowerCase().includes(qAd.toLowerCase()) &&
      (!onlyActive.ad || row.status === "ACTIVE")
  );

  const itemCount = files.length + postIds.length;
  const adsetCount = adsetPerUpload ? Math.max(itemCount, 0) : 1;
  const preview = `${itemCount} ads in ${adsetCount || 1} ad set${adsetCount > 1 ? "s" : ""} will be created`;
  const postLabel = (id: string) => `Post ${id.split("_").pop()}`;

  // Les pubs à créer, dans l'ordre d'envoi (fichiers puis Post ID), avec leur nom final.
  const sourceAdsetRow = adsets.find((row) => row.id === adsetId);
  const sourceCampaignRow = campaigns.find((row) => row.id === (sourceAdsetRow?.campaignId ?? campaignId));
  const groupOf = (index: number) => (adsetPerUpload ? index : autoDivide ? Math.floor(index / 5) : 0);
  const adsetLabelOf = (group: number, groups: number) => {
    if (!(createNewAdset || adsetPerUpload || autoDivide || createNewCampaign || multiCampaigns)) return sourceAdsetRow?.name ?? "Ad set";
    const base = newAdsetName.trim() || `${sourceAdsetRow?.name ?? "Ad set"}`;
    return groups > 1 ? `${base} · ${group + 1}` : newAdsetName.trim() || `${base} · copy`;
  };
  const adItems: PreviewItem[] = (() => {
    const raw = [
      ...previews.map((item) => ({ key: fileKey(item.file), label: item.file.name, url: item.url, video: item.video })),
      ...postIds.map((id) => ({ key: `p:${id}`, label: postLabel(id), postId: id })),
    ];
    const groups = raw.length ? groupOf(raw.length - 1) + 1 : 0;
    return raw.map((item, index) => ({
      ...item,
      name: formatAdName(useNamePattern ? namePattern : "{file}", {
        fileName: item.label,
        campaign: createNewCampaign || multiCampaigns ? newCampaignName.trim() || (sourceCampaignRow ? `${sourceCampaignRow.name} · copy` : "Campaign") : sourceCampaignRow?.name ?? "Campaign",
        adset: adsetLabelOf(groupOf(index), groups),
        index,
        start: Math.max(1, Number(startNumber) || 1),
      }),
    }));
  })();
  const groupCount = adItems.length ? groupOf(adItems.length - 1) + 1 : 0;
  /** Les textes propres à la pub n° index selon le mode choisi (null = textes communs). */
  const ownCopyFor = (index: number): OwnCopy | null => {
    if (textMode === "adset") return ownCopy[`adset:${groupOf(index)}`] ?? null;
    if (textMode === "ad") return adItems[index] ? ownCopy[adItems[index].key] ?? null : null;
    return null;
  };
  const copyFor = (index: number): PreviewCopy => {
    const own = ownCopyFor(index);
    const clean = (list: string[]) => list.map((text) => text.trim()).filter(Boolean);
    return {
      headlines: own?.headline.trim() ? [own.headline.trim()] : clean(headlines),
      bodies: own?.body.trim() ? [own.body.trim()] : clean(bodies),
      descriptions: [],
    };
  };
  const setOwn = (key: string, field: keyof OwnCopy, value: string) =>
    setOwnCopy((current) => ({ ...current, [key]: { ...(current[key] ?? EMPTY_COPY), [field]: value } }));

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const ok = keepMedia(Array.from(list));
    if (ok.length) setFiles((cur) => [...cur, ...ok]);
  }

  async function generateCopy() {
    if (!productUrl.trim()) {
      toast.error("Colle l’URL produit");
      return;
    }
    setBusy("copy");
    try {
      const res = await fetch("/api/meta/upload/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: productUrl }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setHeadlines(body.headlines?.length ? body.headlines : headlines);
      setBodies(body.primaryTexts?.length ? body.primaryTexts : bodies);
      if (body.linkDescription) setDescriptions([body.linkDescription]);
      if (body.websiteUrl) setWebsiteUrl(body.websiteUrl);
      toast.success("Ad copy générée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Copy IA impossible");
    } finally {
      setBusy(null);
    }
  }

  async function createAds() {
    if (!accountId) return toast.error("Choisis un compte");
    if (!files.length && !postIds.length) return toast.error("Ajoute des photos / vidéos ou des Post ID d’abord");
    if (!adsetId && !campaignId) return toast.error("Sélectionne une campagne / un ad set source");
    setBusy("create");
    // La fenêtre de suivi : d'abord les médias, puis ce que le serveur annonce étape par étape.
    const count = files.length + postIds.length;
    const newCamp = createNewCampaign || multiCampaigns;
    const guessAdsets = adsetPerUpload ? count : autoDivide ? Math.ceil(count / 5) : createNewAdset || newCamp ? 1 : 0;
    let items: ProgressItem[] = files.map((file, i) => ({ id: `media-${i}`, step: "media", label: file.name, status: "pending" }));
    let total = files.length + count + (newCamp ? 1 : 0) + guessAdsets + count;
    const startedAt = Date.now();
    const show = (patch: Partial<UploadProgressState> = {}) =>
      setProgress((current) => ({ phase: "running", startedAt, total, items, ...(current?.startedAt === startedAt ? current : {}), ...patch, ...(patch.items ? {} : { items }), ...(patch.total ? {} : { total }) }));
    const setItem = (id: string, patch: Partial<ProgressItem>) => {
      items = items.map((item) => (item.id === id ? { ...item, ...patch } : item));
      show();
    };
    show();
    try {
      const uploaded: UploadedMedia[] = [];
      for (const [i, file] of files.entries()) {
        setItem(`media-${i}`, { status: "running" });
        const form = new FormData();
        form.set("accountId", accountId);
        form.set("file", file);
        const res = await fetch("/api/meta/upload/media", { method: "POST", body: form });
        const body = await res.json().catch(() => ({ error: `Envoi impossible (${res.status})` }));
        if (!res.ok) {
          setItem(`media-${i}`, { status: "error", message: body.error || "Envoi refusé" });
          throw new Error(`Média refusé (${file.name}) : ${body.error || "envoi impossible"}. Rien n'a été créé dans le compte.`);
        }
        setItem(`media-${i}`, { status: "ok" });
        uploaded.push(body.media);
        if (!turbo) await new Promise((r) => setTimeout(r, 250));
      }
      for (const postId of postIds) uploaded.push({ kind: "post", postId, fileName: postLabel(postId) });
      const res = await fetch("/api/meta/upload?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          sourceCampaignId: campaignId || undefined,
          sourceAdsetId: adsetId || undefined,
          sourceAdId: adId || undefined,
          createNewCampaign: createNewCampaign || multiCampaigns,
          createNewAdset,
          adsetPerUpload,
          autoDivide: autoDivide ? 5 : null,
          // Dans la devise du compte (euros pour Venom et Badgal), comme chez Meta. Rien en CBO : c'est la campagne qui porte le budget.
          dailyBudget: cboKept ? null : budgetNumber || null,
          adsetName: newAdsetName.trim() || undefined,
          campaignName: createNewCampaign || multiCampaigns ? newCampaignName.trim() || undefined : undefined,
          adNamePattern: useNamePattern ? namePattern : "{file}",
          startNumber: Math.max(1, Number(startNumber) || 1),
          headlines,
          bodies,
          // Pas de ligne grise sous le titre (« Link description » chez Meta) : Mady n'en veut pas.
          descriptions: [],
          // Textes par ad set ou par pub : un élément par média, dans l'ordre d'envoi.
          copies:
            textMode === "all"
              ? undefined
              : uploaded.map((_, index) => {
                  const own = ownCopyFor(index);
                  return own
                    ? { headlines: own.headline.trim() ? [own.headline] : [], bodies: own.body.trim() ? [own.body] : [], descriptions: [] }
                    : null;
                }),
          websiteUrl,
          displayUrl,
          cta,
          flexible,
          paused,
          aiGenerated,
          enhancements,
          media: uploaded,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: `Erreur ${res.status}` }));
        throw new Error(body.error || "Création ads impossible");
      }
      // Une ligne JSON par étape, au fil de l'eau.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      type Done = { ads?: Array<{ name: string }>; adsetCount?: number };
      let result: Done | null = null;
      let failure: string | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { kind: string; label?: string; ok?: boolean; message?: string; creatives?: number; adsets?: number; ads?: unknown; newCampaign?: boolean; adsetCount?: number };
          if (event.kind === "plan") {
            total = files.length + (event.creatives ?? 0) + (event.newCampaign ? 1 : 0) + (event.adsets ?? 0) + (typeof event.ads === "number" ? event.ads : 0);
            show({ total });
          } else if (event.kind === "done") {
            result = event as unknown as Done;
          } else if (event.kind === "error") {
            failure = event.message ?? "Création ads impossible";
          } else if (event.label) {
            items = [...items, { id: `${event.kind}-${items.length}`, step: event.kind as ProgressItem["step"], label: event.label, status: event.ok ? "ok" : "error", message: event.message }];
            show();
          }
        }
      }
      if (failure) throw new Error(failure);
      const finished = result as Done | null;
      const made = finished?.ads?.length ?? 0;
      const adsetsMade = finished?.adsetCount ?? 1;
      setProgress((current) => (current ? { ...current, items, phase: "done", summary: `${made} pub${made > 1 ? "s" : ""} créée${made > 1 ? "s" : ""} dans ${adsetsMade} ad set${adsetsMade > 1 ? "s" : ""}${paused ? " (en pause)" : ""}.` } : current));
      toast.success(`${made} ads créées`);
      setFiles([]);
      setPostText("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Create ads impossible";
      setProgress((current) => (current ? { ...current, items, phase: "error", error: message } : current));
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  const accountCurrency = (accounts.find((row) => row.id === accountId)?.currency || "USD").toUpperCase();
  const usdRate = accountCurrency === "USD" ? 1 : fx[accountCurrency] > 0 ? fx[accountCurrency] : null;
  const budgetNumber = Number(budget.replace(",", ".")) || 0;
  const currencySign = accountCurrency === "EUR" ? "€" : accountCurrency === "USD" ? "$" : accountCurrency;
  /** La campagne où partent les pubs, et si elle porte le budget (CBO) : alors les ad sets n'en ont pas. */
  const targetCampaign = campaigns.find((row) => row.id === (adsets.find((s) => s.id === adsetId)?.campaignId ?? campaignId));
  const newCampaign = createNewCampaign || multiCampaigns;
  /** La campagne modèle porte le budget (CBO) : ses ad sets, et ceux d'une copie, n'en ont pas. */
  const cbo = Boolean(targetCampaign?.dailyBudget);
  const cboKept = cbo && !newCampaign;
  const budgetHint =
    usdRate && usdRate !== 1 && budgetNumber
      ? `≈ ${Math.round(budgetNumber * usdRate).toLocaleString("fr-FR")} $ (compte en ${accountCurrency}, 1 ${accountCurrency} = ${usdRate.toFixed(3)} $)`
      : null;

  const allEnhanceKeys = useMemo(
    () => [...IMAGE_ENHANCEMENTS, ...VIDEO_ENHANCEMENTS, ...CAROUSEL_ENHANCEMENTS].map((item) => item.key),
    []
  );
  const allOn = allEnhanceKeys.every((key) => enhancements[key]);

  return (
    <div className="space-y-4 text-slate-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Meta Ads Uploader</h1>
          <p className="text-[13px] text-slate-500">Upload media files and configure campaigns for Meta Ads.</p>
        </div>
        <a
          href="https://www.facebook.com/business/help"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white"
        >
          Watch Tutorial
        </a>
      </div>

      <label className="block text-[12px] font-medium text-slate-600">
        Account Selection
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={qAccount}
            onChange={(e) => {
              const next = e.target.value;
              setQAccount(next);
              const digits = next.replace(/\D/g, "");
              if (digits.length < 3) return;
              const hits = accounts.filter((account) => `${account.accountId}${account.id}`.replace(/\D/g, "").includes(digits));
              if (hits.length === 1 && hits[0].id !== accountId) {
                setAccountId(hits[0].id);
                setCampaignId("");
                setAdsetId("");
                setAdId("");
              }
            }}
            placeholder="Rechercher le n° ads account — ou laisse vide pour tous"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13px] outline-none"
          />
        </div>
        <select
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            setCampaignId("");
            setAdsetId("");
            setAdId("");
          }}
          className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none"
        >
          {loadingAccounts ? <option>Loading…</option> : null}
          {filteredAccounts.length === 0 && !loadingAccounts ? <option value="">Aucun compte</option> : null}
          {filteredAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} · {account.accountId}
            </option>
          ))}
        </select>
        {qAccount.trim() ? (
          <p className="mt-1 text-[11px] text-slate-400">
            {filteredAccounts.length} compte{filteredAccounts.length > 1 ? "s" : ""} — vide le champ pour revoir tous
          </p>
        ) : null}
      </label>

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[#1877F2]/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-[#1877F2] bg-white px-10 py-8 text-center shadow-xl">
            <Upload className="mx-auto h-8 w-8 text-[#1877F2]" />
            <p className="mt-2 text-[15px] font-semibold text-slate-800">Lâche tes photos / vidéos ici</p>
            <p className="mt-0.5 text-[12px] text-slate-500">Elles s’ajoutent à l’upload</p>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "rounded-xl border-2 border-dashed bg-white px-6 py-10 text-center transition-colors",
          dragging ? "border-[#1877F2] bg-[#e7f0ff]" : "border-slate-300"
        )}
      >
        <div className="mb-3 flex items-center justify-center gap-4 text-slate-400">
          <HardDrive className="h-8 w-8" />
          <Folder className="h-8 w-8" />
        </div>
        <p className="text-[14px] font-medium">Glisse tes photos / vidéos n’importe où sur la page, colle-les (Ctrl+V) ou parcours tes fichiers.</p>
        <p className="mt-1 text-[12px] text-slate-400">
          Supported: JPG, PNG, WEBP, GIF, MP4, MOV, M4V. Videos up to 4GB, images up to 30MB.
        </p>
        <label className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-medium">
          <Upload className="h-3.5 w-3.5" />
          Browse
          <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </label>
        {previews.length ? (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {previews.map((item, i) => (
              <div key={`${item.file.name}-${i}`} className="group relative overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                {item.video ? (
                  <video src={item.url} muted playsInline className="aspect-[4/5] w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt={item.file.name} className="aspect-[4/5] w-full object-cover" />
                )}
                <p className="truncate px-1.5 py-1 text-left text-[10px] text-slate-600" title={item.file.name}>
                  {item.file.name}
                </p>
                <button
                  type="button"
                  title="Retirer"
                  onClick={() => setFiles((cur) => cur.filter((_, idx) => idx !== i))}
                  className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Hash className="h-3.5 w-3.5 text-[#1877F2]" />
          Post ID — publications existantes
        </p>
        <p className="mt-1 text-[12px] text-slate-500">
          Colle un ou plusieurs Post ID (bouton « Post ID » de l’Ads Manager), un par ligne. Chaque post devient une pub qui le reprend tel
          quel : même visuel, même texte, likes et commentaires gardés. Les textes et le lien plus bas ne s’appliquent pas à ces pubs.
        </p>
        <textarea
          value={postText}
          onChange={(e) => setPostText(e.target.value)}
          rows={3}
          placeholder={"123456789012345_987654321098765\n…"}
          className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[12px] outline-none"
        />
        {postText.trim() ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={cn("font-medium", postIds.length ? "text-emerald-700" : "text-rose-600")}>
              {postIds.length ? `${postIds.length} post${postIds.length > 1 ? "s" : ""} reconnu${postIds.length > 1 ? "s" : ""}` : "Aucun Post ID reconnu"}
            </span>
          </div>
        ) : null}
        {postIds.length ? (
          <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
            {postIds.map((id) => (
              <PostPreview key={`${accountId}-${id}`} accountId={accountId} postId={id} onRemove={() => setPostText((text) => removePostId(text, id))} />
            ))}
          </div>
        ) : null}
      </section>

      <div className="flex justify-end">
        <label className="inline-flex items-center gap-2 text-[12px] font-medium">
          Turbo Mode
          <button
            type="button"
            onClick={() => setTurbo((v) => !v)}
            className={cn("relative h-5 w-9 rounded-full", turbo ? "bg-[#1877F2]" : "bg-slate-300")}
          >
            <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition", turbo ? "left-4" : "left-0.5")} />
          </button>
        </label>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[13px] font-semibold">Configuration Method</p>
        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={method === "copy"} onChange={() => setMethod("copy")} />
          Select a Meta Ad to Copy Settings From
          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Most Popular</span>
        </label>
        <label className="mt-2 flex items-center gap-2 text-[13px] text-slate-500">
          <input type="checkbox" checked={method === "xlsx"} onChange={() => setMethod("xlsx")} />
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Upload Ad Configuration XLSX
        </label>
      </section>

      {method === "copy" ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-[13px] font-semibold">Select Ad from Facebook</p>
            <button
              type="button"
              onClick={() => void loadTree(accountId, true)}
              className={cn("inline-flex h-8 items-center gap-1 rounded-md px-3 text-[12px] font-medium", META_BLUE)}
            >
              {loadingTree ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </button>
          </div>
          <div className="grid md:grid-cols-3">
            <PickerColumn
              title="Campaigns"
              query={qCampaign}
              onQuery={setQCampaign}
              onlyActive={onlyActive.campaign}
              onOnlyActive={(v) => setOnlyActive((s) => ({ ...s, campaign: v }))}
              empty="No campaigns found"
              items={filteredCampaigns}
              selected={campaignId}
              onSelect={(id) => {
                setCampaignId(id);
                setAdsetId("");
                setAdId("");
              }}
            />
            <PickerColumn
              title="Ad Sets"
              query={qAdset}
              onQuery={setQAdset}
              onlyActive={onlyActive.adset}
              onOnlyActive={(v) => setOnlyActive((s) => ({ ...s, adset: v }))}
              empty={campaignId ? "No ad sets found" : "Select a campaign"}
              items={filteredAdsets}
              selected={adsetId}
              onSelect={(id) => {
                setAdsetId(id);
                setAdId("");
                const picked = adsets.find((row) => row.id === id);
                const parent = campaigns.find((row) => row.id === picked?.campaignId);
                const value = picked?.dailyBudget || parent?.dailyBudget || 0;
                setBudget(value ? String(value) : "");
                setNewAdsetName("");
              }}
            />
            <PickerColumn
              title="Ads"
              query={qAd}
              onQuery={setQAd}
              onlyActive={onlyActive.ad}
              onOnlyActive={(v) => setOnlyActive((s) => ({ ...s, ad: v }))}
              empty={adsetId ? "No ads found" : "Select an ad set"}
              items={filteredAds}
              selected={adId}
              onSelect={(id) => void pickTemplateAd(id)}
            />
          </div>
          <div className="flex justify-end border-t border-slate-100 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setCampaignId("");
                setAdsetId("");
                setAdId("");
              }}
              className="text-[12px] text-slate-500"
            >
              Reset Selection
            </button>
          </div>
        </section>
      ) : (
        <label className="block rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-[13px] text-slate-500">
          CSV / XLSX with campaign_id, adset_id
          <input
            type="file"
            accept=".csv,.xlsx"
            className="mt-2 block w-full text-[12px]"
            onChange={() => toast.message("Utilise Copy Settings From pour cloner targeting + budget.")}
          />
        </label>
      )}

      <Card title="Campaign Options">
        <CheckRow
          label="Create new campaign"
          checked={createNewCampaign}
          onChange={(value) => {
            setCreateNewCampaign(value);
            // Une nouvelle campagne a forcément son propre ad set.
            if (value) setCreateNewAdset(true);
          }}
        />
        <CheckRow
          label="Create multiple new campaigns"
          checked={multiCampaigns}
          onChange={(value) => {
            setMultiCampaigns(value);
            if (value) setCreateNewAdset(true);
          }}
        />
        {newCampaign ? (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
            <label className="block text-[12px] font-medium text-slate-600">
              Nom de la nouvelle campagne
              <input
                value={newCampaignName}
                onChange={(e) => setNewCampaignName(e.target.value)}
                placeholder={targetCampaign ? `${targetCampaign.name} · copy` : "Choisis d'abord une campagne modèle"}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px]"
              />
              <span className="mt-1 block text-[11px] font-normal text-slate-400">
                Copie des réglages de « {targetCampaign?.name ?? "la campagne modèle"} » (objectif, enchères{cbo ? ", budget CBO" : ""}).
              </span>
            </label>
            {cbo ? (
              <label className="block text-[12px] font-medium text-slate-600">
                Budget / jour de la nouvelle campagne · CBO ({currencySign})
                <input
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="même que le modèle"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px]"
                />
                {budgetHint ? <span className="mt-1 block text-[11px] font-normal text-slate-500">{budgetHint}</span> : null}
                <span className="mt-1 block text-[11px] font-normal text-slate-400">Campagne CBO : c&apos;est elle qui porte le budget, ses ad sets n&apos;en ont pas.</span>
              </label>
            ) : (
              <p className="self-end text-[11px] text-slate-400">Campagne ABO : le budget se règle sur chaque ad set, juste en dessous.</p>
            )}
          </div>
        ) : null}
        {(() => {
          // Les pubs créées dans une campagne en pause ne tournent pas (et sont cachées par le filtre « Actifs » de l'Ads Manager).
          const target = campaigns.find((row) => row.id === (adsets.find((s) => s.id === adsetId)?.campaignId ?? campaignId));
          if (!target || target.status === "ACTIVE" || createNewCampaign || multiCampaigns) return null;
          return (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 ring-1 ring-amber-200">
              La campagne « {target.name} » est <strong>en pause</strong> chez Meta : les pubs créées dedans ne tourneront pas et
              n’apparaîtront pas dans l’Ads Manager (filtre « Actifs »). Coche « Create new campaign » pour une nouvelle campagne qui
              part en live, ou rallume celle-ci dans l’Ads Manager.
            </p>
          );
        })()}
      </Card>
      <Card title="Ad Set Options">
        <CheckRow label="Create new ad set" checked={createNewAdset} onChange={setCreateNewAdset} />
        <CheckRow label="Create new ad set per upload or group" checked={adsetPerUpload} onChange={setAdsetPerUpload} />
        <CheckRow label="Auto-divide ads into ad sets" checked={autoDivide} onChange={setAutoDivide} />
        <CheckRow label="Build custom ad set configuration" checked={customAdset} onChange={setCustomAdset} />
        {createNewAdset || adsetPerUpload || autoDivide || newCampaign ? (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
            <label className="block text-[12px] font-medium text-slate-600">
              Nom du nouvel ad set
              <input
                value={newAdsetName}
                onChange={(e) => setNewAdsetName(e.target.value)}
                placeholder={adsetId ? `${adsets.find((row) => row.id === adsetId)?.name ?? "Ad set"} · copy` : "Choisis d'abord un ad set modèle"}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px]"
              />
            </label>
            {cbo && targetCampaign ? (
              <div className="rounded-lg bg-violet-50 px-3 py-2 text-[12px] text-violet-900 ring-1 ring-violet-200">
                <p className="font-semibold">Pas de budget d&apos;ad set : campagne en CBO</p>
                <p className="mt-0.5 text-[11px] text-violet-700">
                  {newCampaign
                    ? "C'est la nouvelle campagne qui porte le budget (réglé juste au-dessus) : Meta le répartit entre ses ad sets."
                    : `C'est la campagne « ${targetCampaign.name} » qui porte le budget (${targetCampaign.dailyBudget.toLocaleString("fr-FR")} ${currencySign} / jour) : Meta le répartit entre ses ad sets. Pour le changer, modifie le budget de la campagne dans l'Ads Manager.`}
                </p>
              </div>
            ) : (
              <label className="block text-[12px] font-medium text-slate-600">
                Budget / jour du nouvel ad set · ABO ({currencySign})
                <input
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="même que le modèle"
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px]"
                />
                {budgetHint ? <span className="mt-1 block text-[11px] font-normal text-slate-500">{budgetHint}</span> : null}
                <span className="mt-1 block text-[11px] font-normal text-slate-400">Budget par ad set (ABO) : appliqué à chaque nouvel ad set.</span>
              </label>
            )}
          </div>
        ) : null}
      </Card>
      <Card title="Ad Name Options">
        <CheckRow label="Use custom ad name pattern" checked={useNamePattern} onChange={setUseNamePattern} />
        {useNamePattern ? (
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              <input
                value={namePattern}
                onChange={(e) => setNamePattern(e.target.value)}
                className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 font-mono text-[13px]"
                placeholder="S {nn}"
              />
              <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500" title="Premier numéro pour {n} et {nn}">
                N° de départ
                <input
                  inputMode="numeric"
                  value={startNumber}
                  onChange={(e) => setStartNumber(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="h-10 w-16 rounded-lg border border-slate-200 px-2 text-center text-[13px]"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {AD_NAME_TOKENS.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  title={`${item.label} — ex. ${item.example}`}
                  onClick={() => setNamePattern((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${item.token}`)}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-200"
                >
                  <code className="font-mono font-semibold">{item.token}</code>
                  <span className="text-slate-500">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>
      <Card title="Preview">
        <p className="text-[13px] text-slate-600">{preview}</p>
        {itemCount ? (
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100">
            {adItems.slice(0, 50).map((item, index) => (
              <li key={`${item.key}-${index}`} className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-slate-400" title={item.label}>
                  {item.label}
                </span>
                <span className="text-slate-300">→</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-800" title={item.name}>
                  {item.name}
                </span>
                <PreviewButton onClick={() => setPreviewIndex(index)} />
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-[18px] font-semibold">Ad Texts & Settings</h2>
        <div className="mt-3 space-y-1.5 text-[13px]">
          <CheckRow label="Apply common text to all ads" checked={textMode === "all"} onChange={() => setTextMode("all")} />
          <CheckRow label="Write unique ad text per ad set." checked={textMode === "adset"} onChange={() => setTextMode("adset")} />
          <CheckRow label="Write unique ad text for each ad." checked={textMode === "ad"} onChange={() => setTextMode("ad")} />
        </div>
        {textMode !== "all" ? (
          <div className="mt-3 space-y-2">
            <p className="text-[12px] text-slate-500">
              {textMode === "adset" ? "Un texte par ad set" : "Un texte par pub"} : laisse un champ vide pour reprendre le texte commun (plus bas).
            </p>
            {!adItems.length ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500">Ajoute d&apos;abord tes photos / vidéos ou tes Post ID.</p>
            ) : textMode === "adset" ? (
              Array.from({ length: groupCount }, (_, group) => {
                const first = adItems.findIndex((_, index) => groupOf(index) === group);
                const count = adItems.filter((_, index) => groupOf(index) === group).length;
                return (
                  <OwnCopyEditor
                    key={`adset-${group}`}
                    title={adsetLabelOf(group, groupCount)}
                    subtitle={`${count} pub${count > 1 ? "s" : ""}`}
                    value={ownCopy[`adset:${group}`] ?? EMPTY_COPY}
                    common={copyFor(-1)}
                    onChange={(field, value) => setOwn(`adset:${group}`, field, value)}
                    onPreview={() => setPreviewIndex(first)}
                  />
                );
              })
            ) : (
              adItems.map((item, index) => (
                <OwnCopyEditor
                  key={item.key}
                  title={item.name}
                  subtitle={item.label}
                  thumb={item.url}
                  video={item.video}
                  locked={Boolean(item.postId)}
                  value={ownCopy[item.key] ?? EMPTY_COPY}
                  common={copyFor(-1)}
                  onChange={(field, value) => setOwn(item.key, field, value)}
                  onPreview={() => setPreviewIndex(index)}
                />
              ))
            )}
          </div>
        ) : null}

        <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50/70 p-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Sparkles className="h-3.5 w-3.5 text-sky-700" />
            IA Ad Copy
          </p>
          <p className="mt-1 text-[12px] text-slate-500">Colle l’URL produit — génération headlines + descriptions style Meta ads.</p>
          <div className="mt-2 flex gap-2">
            <input
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              placeholder="https://shop…/products/…"
              className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-[12px] outline-none"
            />
            <button
              type="button"
              onClick={() => void generateCopy()}
              disabled={busy !== null}
              className={cn("inline-flex h-9 items-center gap-1 rounded-lg px-3 text-[12px] font-semibold", META_BLUE)}
            >
              {busy === "copy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate
            </button>
          </div>
        </div>

        <FieldHeader
          label="Headlines"
          flexible={flexible}
          onFlexible={setFlexible}
          onAdd={() => setHeadlines((list) => [...list, ""])}
        />
        {headlines.map((value, i) => (
          <Line key={`h-${i}`} value={value} onChange={(v) => setHeadlines(patch(headlines, i, v))} onRemove={() => setHeadlines(headlines.filter((_, idx) => idx !== i))} />
        ))}

        {/* Le texte au-dessus du visuel (« Primary text » chez Meta) : appelé « Description » ici, comme Mady le nomme. */}
        <FieldHeader label="Descriptions (texte au-dessus du visuel)" onAdd={() => setBodies((list) => [...list, ""])} />
        {bodies.map((value, i) => (
          <Area key={`b-${i}`} value={value} onChange={(v) => setBodies(patch(bodies, i, v))} onRemove={() => setBodies(bodies.filter((_, idx) => idx !== i))} />
        ))}

        <label className="mt-4 block text-[13px] font-medium">
          Call to Action
          <select value={cta} onChange={(e) => setCta(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px]">
            {CTA_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-[13px] font-medium">
          Website URL
          <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px]" />
        </label>
        <label className="mt-3 block text-[13px] font-medium">
          Display URL
          <input
            value={displayUrl}
            onChange={(e) => setDisplayUrl(e.target.value)}
            placeholder="Enter display URL (e.g., example.com)"
            className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px]"
          />
        </label>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-[15px] font-semibold">Creative Enhancements</h3>
        <p className="text-[12px] text-slate-500">Select Advantage+ enhancements to enable. Available options vary by media type.</p>
        <label className="mt-2 flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={allOn}
            onChange={(e) => {
              const next: Record<string, boolean> = {};
              for (const key of allEnhanceKeys) next[key] = e.target.checked;
              setEnhancements(next);
            }}
          />
          Select All
        </label>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <EnhanceCol title="Images" items={IMAGE_ENHANCEMENTS} value={enhancements} onChange={setEnhancements} />
          <EnhanceCol title="Videos" items={VIDEO_ENHANCEMENTS} value={enhancements} onChange={setEnhancements} />
          <EnhanceCol title="Carousel" items={CAROUSEL_ENHANCEMENTS} value={enhancements} onChange={setEnhancements} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-[15px] font-semibold">AI Transparency</h3>
        <p className="text-[12px] text-slate-500">Control Meta’s AI-generated content self-disclosure for new creatives.</p>
        <label className="mt-3 flex items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-0.5" checked={aiGenerated} onChange={(e) => setAiGenerated(e.target.checked)} />
          <span>
            AI-generated content
            <span className="mt-0.5 block text-[12px] text-slate-500">
              Discloses that this ad’s creative was created or significantly edited with AI.
            </span>
          </span>
        </label>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-[15px] font-semibold">Publication Options</h3>
        <label className="mt-3 flex items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-0.5" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          <span>
            Create ads in paused status
            <span className="mt-0.5 block text-[12px] text-slate-500">
              Ads will be created but won’t run until you manually activate them in Meta Ads Manager.
            </span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-2 text-[13px] text-slate-400">
          <input type="checkbox" disabled className="mt-0.5" />
          <span>
            Schedule these ads to start at a specific time
            <span className="mt-0.5 block text-[12px]">Scheduling is only available when creating new ad sets.</span>
          </span>
        </label>
      </section>

      {!itemCount ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-[13px] text-slate-600">Aucun média ni Post ID : ajoute des photos / vidéos ou colle des Post ID plus haut.</p>
      ) : null}

      <button
        type="button"
        disabled={busy !== null || !itemCount}
        onClick={() => void createAds()}
        className={cn("h-11 w-full rounded-lg text-[14px] font-semibold disabled:opacity-50", META_BLUE)}
      >
        {busy === "create" ? "Creating ads…" : "Create Ads"}
      </button>
      {progress ? <UploadProgress state={progress} onClose={() => setProgress(null)} /> : null}
      {previewIndex != null && adItems[previewIndex] ? (
        <AdPreviewPanel
          items={adItems}
          index={previewIndex}
          onIndex={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          copyFor={copyFor}
          cta={cta}
          websiteUrl={websiteUrl}
          displayUrl={displayUrl}
          pageName={accounts.find((row) => row.id === accountId || row.accountId === accountId)?.name ?? ""}
          renderPost={(postId) => <PostPreview accountId={accountId} postId={postId} onRemove={() => setPostText((text) => removePostId(text, postId))} />}
        />
      ) : null}
    </div>
  );
}

function PreviewButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#e7f0ff] px-2 py-1 text-[11px] font-semibold text-[#1877F2] hover:bg-[#d8e6ff]"
      title="Voir la pub sur iPhone : Facebook, Instagram, Stories, Reels"
    >
      <Eye className="h-3.5 w-3.5" />
      Aperçu
    </button>
  );
}

/** Les textes d'un ad set ou d'une pub : titre, texte principal, description (vide = texte commun). */
function OwnCopyEditor({
  title,
  subtitle,
  thumb,
  video,
  locked,
  value,
  common,
  onChange,
  onPreview,
}: {
  title: string;
  subtitle: string;
  thumb?: string;
  video?: boolean;
  locked?: boolean;
  value: OwnCopy;
  common: PreviewCopy;
  onChange: (field: keyof OwnCopy, value: string) => void;
  onPreview: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        {thumb ? (
          video ? (
            <video src={thumb} className="h-10 w-10 shrink-0 rounded-md object-cover" muted />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
          )
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold" title={title}>
            {title}
          </p>
          <p className="truncate text-[11px] text-slate-400">{subtitle}</p>
        </div>
        <PreviewButton onClick={onPreview} />
      </div>
      {locked ? (
        <p className="mt-2 text-[12px] text-slate-500">Publication existante : elle garde son propre texte.</p>
      ) : (
        <div className="mt-2 space-y-2">
          <label className="block text-[12px] font-medium">
            Headline
            <input
              value={value.headline}
              onChange={(e) => onChange("headline", e.target.value)}
              placeholder={common.headlines[0] ?? "Titre"}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-[13px] font-normal"
            />
          </label>
          <label className="block text-[12px] font-medium">
            Description (texte au-dessus du visuel)
            <textarea
              value={value.body}
              onChange={(e) => onChange("body", e.target.value)}
              placeholder={common.bodies[0] ?? "Description"}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-normal"
            />
          </label>
        </div>
      )}
    </div>
  );
}

/** Retire un Post ID du champ (toutes les écritures qui y mènent : ID nu, ID complet ou lien). */
function removePostId(text: string, id: string) {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .split(/([\s,;]+)/)
        .filter((token) => !parsePostIds(token).includes(id))
        .join("")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}

type PreviewState = { status: "loading" } | { status: "ok"; src: string; storyId: string } | { status: "error"; message: string };

/** Les aperçus déjà demandés (compte + post), pour ne pas rappeler Meta à chaque frappe. */
const postPreviews = new Map<string, Promise<PreviewState>>();

function loadPostPreview(accountId: string, postId: string): Promise<PreviewState> {
  const key = `${accountId}|${postId}`;
  const known = postPreviews.get(key);
  if (known) return known;
  const promise = fetch(`/api/meta/upload?accountId=${encodeURIComponent(accountId)}&postId=${encodeURIComponent(postId)}`)
    .then(async (res) => {
      const body = (await res.json()) as { preview?: { src: string; storyId: string }; error?: string };
      if (!res.ok || !body.preview) return { status: "error", message: body.error || "Aperçu indisponible" } as PreviewState;
      return { status: "ok", ...body.preview } as PreviewState;
    })
    .catch(() => {
      postPreviews.delete(key);
      return { status: "error", message: "Meta ne répond pas, réessaie." } as PreviewState;
    });
  postPreviews.set(key, promise);
  return promise;
}

/** L'aperçu Meta d'un Post ID collé : la pub telle qu'elle sortira, pour vérifier que c'est le bon post. */
function PostPreview({ accountId, postId, onRemove }: { accountId: string; postId: string; onRemove: () => void }) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    if (!accountId) return;
    void loadPostPreview(accountId, postId).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, postId]);

  return (
    <div className="relative w-[340px] shrink-0 overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-2 py-1.5">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            state.status === "ok" ? "bg-emerald-500" : state.status === "error" ? "bg-rose-500" : "animate-pulse bg-slate-300"
          )}
        />
        <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-600" title={postId}>
          {postId}
        </code>
        <button type="button" title="Retirer ce post" onClick={onRemove} className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X className="h-3 w-3" />
        </button>
      </div>
      {!accountId ? (
        <p className="px-3 py-10 text-center text-[12px] text-slate-500">Choisis d’abord le compte pub.</p>
      ) : state.status === "loading" ? (
        <p className="flex items-center justify-center gap-1.5 px-3 py-10 text-[12px] text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aperçu Meta…
        </p>
      ) : state.status === "error" ? (
        <p className="px-3 py-8 text-center text-[12px] text-rose-600">{state.message}</p>
      ) : (
        <iframe src={state.src} title={`Aperçu ${postId}`} className="h-[560px] w-full border-0 bg-white" scrolling="no" loading="lazy" />
      )}
    </div>
  );
}

function patch(list: string[], index: number, value: string) {
  return list.map((item, i) => (i === index ? value : item));
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <div className="mt-2 space-y-1.5">{children}</div>
    </section>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function FieldHeader({
  label,
  flexible,
  onFlexible,
  onAdd,
}: {
  label: string;
  flexible?: boolean;
  onFlexible?: (v: boolean) => void;
  onAdd: () => void;
}) {
  return (
    <div className="mt-5 mb-2 flex items-center gap-2">
      <p className="text-[13px] font-semibold">{label}</p>
      {onFlexible ? (
        <div className="ml-2 inline-flex rounded-md bg-slate-100 p-0.5 text-[11px] font-medium">
          <button type="button" onClick={() => onFlexible(true)} className={cn("rounded px-2 py-0.5", flexible ? "bg-slate-900 text-white" : "text-slate-500")}>
            Flexible Texts
          </button>
          <button type="button" onClick={() => onFlexible(false)} className={cn("rounded px-2 py-0.5", !flexible ? "bg-slate-900 text-white" : "text-slate-500")}>
            Separate Ads
          </button>
        </div>
      ) : null}
      <button type="button" onClick={onAdd} className={cn("ml-auto grid h-7 w-7 place-items-center rounded-md", META_BLUE)}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function Line({
  value,
  onChange,
  onRemove,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
  placeholder?: string;
}) {
  return (
    <div className="mb-2 flex gap-2">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-[13px]" />
      <button type="button" onClick={onRemove} className="grid h-10 w-10 place-items-center rounded-md border border-red-200 text-red-500">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function Area({ value, onChange, onRemove }: { value: string; onChange: (v: string) => void; onRemove: () => void }) {
  return (
    <div className="mb-2 flex gap-2">
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
      <button type="button" onClick={onRemove} className="grid h-10 w-10 place-items-center rounded-md border border-red-200 text-red-500">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function EnhanceCol({
  title,
  items,
  value,
  onChange,
}: {
  title: string;
  items: readonly { key: string; label: string }[];
  value: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}) {
  return (
    <div>
      <p className="text-[12px] font-semibold">{title}</p>
      <div className="mt-2 space-y-1.5">
        {items.map((item) => (
          <label key={`${title}-${item.key}`} className="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={Boolean(value[item.key])}
              onChange={(e) => onChange({ ...value, [item.key]: e.target.checked })}
            />
            {item.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function PickerColumn({
  title,
  query,
  onQuery,
  onlyActive,
  onOnlyActive,
  items,
  selected,
  onSelect,
  empty,
}: {
  title: string;
  query: string;
  onQuery: (v: string) => void;
  onlyActive: boolean;
  onOnlyActive: (v: boolean) => void;
  items: Array<{ id: string; name: string; status: string }>;
  selected: string;
  onSelect: (id: string) => void;
  empty: string;
}) {
  return (
    <div className="min-h-[280px] border-slate-100 p-2 md:border-r md:last:border-r-0">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}...`}
          className="h-8 w-full rounded-md border border-slate-200 pl-7 pr-2 text-[12px] outline-none"
        />
      </div>
      <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
        <input type="checkbox" checked={onlyActive} onChange={(e) => onOnlyActive(e.target.checked)} />
        Only active
      </label>
      <div className="mt-1 max-h-[240px] overflow-auto">
        {items.length ? (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]",
                selected === item.id ? "bg-[#e7f0ff] text-[#1877F2]" : "hover:bg-slate-50"
              )}
            >
              <span className={cn("grid h-4 w-4 place-items-center rounded border", selected === item.id ? "border-[#1877F2] bg-[#1877F2] text-white" : "border-slate-300")}>
                {selected === item.id ? <Check className="h-3 w-3" /> : null}
              </span>
              <span className="truncate">{item.name}</span>
            </button>
          ))
        ) : (
          <p className="px-2 py-8 text-center text-[12px] text-slate-400">{empty}</p>
        )}
      </div>
    </div>
  );
}
