"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  FileSpreadsheet,
  Folder,
  HardDrive,
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
import {
  CAROUSEL_ENHANCEMENTS,
  CTA_OPTIONS,
  IMAGE_ENHANCEMENTS,
  VIDEO_ENHANCEMENTS,
  type PickerAd,
  type PickerAdset,
  type PickerCampaign,
  type UploadAccount,
  type UploadedMedia,
} from "@/lib/meta/uploader-shared";

const META_BLUE = "bg-[#1877F2] hover:bg-[#166fe5] text-white";

type TextMode = "all" | "adset" | "ad";

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
  const [createNewCampaign, setCreateNewCampaign] = useState(false);
  const [multiCampaigns, setMultiCampaigns] = useState(false);
  const [createNewAdset, setCreateNewAdset] = useState(true);
  const [adsetPerUpload, setAdsetPerUpload] = useState(false);
  const [autoDivide, setAutoDivide] = useState(false);
  const [customAdset, setCustomAdset] = useState(false);
  const [useNamePattern, setUseNamePattern] = useState(true);
  const [namePattern, setNamePattern] = useState("{file}");
  const [textMode, setTextMode] = useState<TextMode>("all");
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
  const [paused, setPaused] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/meta/upload");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        setAccounts(body.accounts || []);
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

  useEffect(() => {
    if (accountId) void loadTree(accountId);
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

  const adsetCount = adsetPerUpload ? Math.max(files.length, 0) : 1;
  const preview = `${files.length} ads in ${adsetCount || 1} ad set${adsetCount > 1 ? "s" : ""} will be created`;

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setFiles((cur) => [...cur, ...Array.from(list)]);
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
    if (!files.length) return toast.error("Upload des médias d’abord");
    if (!adsetId && !campaignId) return toast.error("Sélectionne une campagne / un ad set source");
    setBusy("create");
    try {
      const uploaded: UploadedMedia[] = [];
      for (const file of files) {
        const form = new FormData();
        form.set("accountId", accountId);
        form.set("file", file);
        const res = await fetch("/api/meta/upload/media", { method: "POST", body: form });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        uploaded.push(body.media);
        if (!turbo) await new Promise((r) => setTimeout(r, 250));
      }
      const res = await fetch("/api/meta/upload", {
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
          adNamePattern: useNamePattern ? namePattern : "{file}",
          headlines,
          bodies,
          descriptions,
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
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      toast.success(`${body.ads?.length || 0} ads créées`);
      setFiles([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Create ads impossible");
    } finally {
      setBusy(null);
    }
  }

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

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        className="rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center"
      >
        <div className="mb-3 flex items-center justify-center gap-4 text-slate-400">
          <HardDrive className="h-8 w-8" />
          <Folder className="h-8 w-8" />
        </div>
        <p className="text-[14px] font-medium">Drag and drop files here, or browse for files.</p>
        <p className="mt-1 text-[12px] text-slate-400">
          Supported: JPG, PNG, WEBP, GIF, MP4, MOV, M4V. Videos up to 4GB, images up to 30MB.
        </p>
        <label className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-medium">
          <Upload className="h-3.5 w-3.5" />
          Browse
          <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </label>
        {files.length ? (
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {files.map((file, i) => (
              <span key={`${file.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">
                {file.name}
                <button type="button" onClick={() => setFiles((cur) => cur.filter((_, idx) => idx !== i))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

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
              onSelect={setAdId}
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
        <CheckRow label="Create new campaign" checked={createNewCampaign} onChange={setCreateNewCampaign} />
        <CheckRow label="Create multiple new campaigns" checked={multiCampaigns} onChange={setMultiCampaigns} />
      </Card>
      <Card title="Ad Set Options">
        <CheckRow label="Create new ad set" checked={createNewAdset} onChange={setCreateNewAdset} />
        <CheckRow label="Create new ad set per upload or group" checked={adsetPerUpload} onChange={setAdsetPerUpload} />
        <CheckRow label="Auto-divide ads into ad sets" checked={autoDivide} onChange={setAutoDivide} />
        <CheckRow label="Build custom ad set configuration" checked={customAdset} onChange={setCustomAdset} />
      </Card>
      <Card title="Ad Name Options">
        <CheckRow label="Use custom ad name pattern" checked={useNamePattern} onChange={setUseNamePattern} />
        {useNamePattern ? (
          <input
            value={namePattern}
            onChange={(e) => setNamePattern(e.target.value)}
            className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-3 text-[12px]"
            placeholder="{file} · {adset}"
          />
        ) : null}
      </Card>
      <Card title="Preview">
        <p className="text-[13px] text-slate-600">{preview}</p>
      </Card>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-[18px] font-semibold">Ad Texts & Settings</h2>
        <div className="mt-3 space-y-1.5 text-[13px]">
          <CheckRow label="Apply common text to all ads" checked={textMode === "all"} onChange={() => setTextMode("all")} />
          <CheckRow label="Write unique ad text per ad set." checked={textMode === "adset"} onChange={() => setTextMode("adset")} />
          <CheckRow label="Write unique ad text for each ad." checked={textMode === "ad"} onChange={() => setTextMode("ad")} />
        </div>

        <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50/70 p-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Sparkles className="h-3.5 w-3.5 text-sky-700" />
            IA Ad Copy
          </p>
          <p className="mt-1 text-[12px] text-slate-500">Colle l’URL produit — génération headlines + primary texts style Meta ads.</p>
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

        <FieldHeader label="Primary Texts" onAdd={() => setBodies((list) => [...list, ""])} />
        {bodies.map((value, i) => (
          <Area key={`b-${i}`} value={value} onChange={(v) => setBodies(patch(bodies, i, v))} onRemove={() => setBodies(bodies.filter((_, idx) => idx !== i))} />
        ))}

        <FieldHeader label="Link Descriptions" onAdd={() => setDescriptions((list) => [...list, ""])} />
        {descriptions.map((value, i) => (
          <Line
            key={`d-${i}`}
            value={value}
            placeholder="Enter link description"
            onChange={(v) => setDescriptions(patch(descriptions, i, v))}
            onRemove={() => setDescriptions(descriptions.filter((_, idx) => idx !== i))}
          />
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

      {!files.length ? (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-[13px] text-slate-600">No Media Uploaded. To create ads, first add media above.</p>
      ) : null}

      <button
        type="button"
        disabled={busy !== null || !files.length}
        onClick={() => void createAds()}
        className={cn("h-11 w-full rounded-lg text-[14px] font-semibold disabled:opacity-50", META_BLUE)}
      >
        {busy === "create" ? "Creating ads…" : "Create Ads"}
      </button>
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
