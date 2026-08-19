import { discoverAdAccounts, getMetaConfigWithExtras } from "@/lib/meta/client";
import { graphGet, graphPost, graphPostForm, type GraphError } from "@/lib/meta/graph";
import { resolveToken } from "@/lib/meta/token";
import { invalidateTreeCache } from "@/lib/meta/tree";
import {
  type PickerAd,
  type PickerAdset,
  type PickerCampaign,
  type UploadAccount,
  type UploadedMedia,
} from "@/lib/meta/uploader-shared";

export type { PickerAd, PickerAdset, PickerCampaign, UploadAccount, UploadedMedia };
export {
  CAROUSEL_ENHANCEMENTS,
  CTA_OPTIONS,
  IMAGE_ENHANCEMENTS,
  VIDEO_ENHANCEMENTS,
} from "@/lib/meta/uploader-shared";

type Paged<T> = GraphError & { data?: T[]; paging?: { next?: string } };

async function allPages<T>(path: string, token: string) {
  const rows: T[] = [];
  const first = await graphGet<Paged<T>>(path, token);
  if (first.error) throw new Error(first.error.message);
  rows.push(...(first.data || []));
  let next = first.paging?.next;
  for (let i = 0; i < 20 && next; i++) {
    const res = await fetch(next, { cache: "no-store" });
    const body = (await res.json()) as Paged<T>;
    if (body.error) throw new Error(body.error.message);
    rows.push(...(body.data || []));
    next = body.paging?.next;
  }
  return rows;
}

export async function listUploadAccounts(): Promise<UploadAccount[]> {
  const config = await getMetaConfigWithExtras();
  if (!config) throw new Error("Meta is not configured");
  const { accounts } = await discoverAdAccounts(config);
  return accounts
    .map(({ token: _t, ...rest }) => {
      void _t;
      return rest;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAccountStructure(accountId: string) {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const token = await resolveToken(act);
  const [campaigns, adsets, ads] = await Promise.all([
    allPages<{ id: string; name: string; status: string; objective?: string }>(
      `${act}/campaigns?fields=id,name,status,objective&limit=200`,
      token
    ),
    allPages<{ id: string; name: string; status: string; campaign_id: string }>(
      `${act}/adsets?fields=id,name,status,campaign_id&limit=300`,
      token
    ),
    allPages<{ id: string; name: string; status: string; adset_id: string; campaign_id: string }>(
      `${act}/ads?fields=id,name,status,adset_id,campaign_id&limit=500`,
      token
    ),
  ]);
  return {
    campaigns: campaigns.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      objective: row.objective || "",
    })) as PickerCampaign[],
    adsets: adsets.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      campaignId: row.campaign_id,
    })) as PickerAdset[],
    ads: ads.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      adsetId: row.adset_id,
      campaignId: row.campaign_id,
    })) as PickerAd[],
  };
}

export async function uploadMediaFile(accountId: string, file: File): Promise<UploadedMedia> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const token = await resolveToken(act);
  const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(file.name);

  if (isVideo) {
    const form = new FormData();
    form.set("name", file.name.replace(/\.[^.]+$/, ""));
    form.set("source", file);
    const body = await graphPostForm<GraphError & { id?: string }>(`${act}/advideos`, token, form);
    if (body.error || !body.id) throw new Error(body.error?.message || `Upload vidéo échoué (${file.name})`);
    return { kind: "video", videoId: body.id, fileName: file.name };
  }

  const bytes = Buffer.from(await file.arrayBuffer()).toString("base64");
  const body = await graphPost<GraphError & { images?: Record<string, { hash?: string }> }>(`${act}/adimages`, token, {
    bytes,
    name: file.name,
  });
  if (body.error) throw new Error(body.error.message);
  const hash = Object.values(body.images || {})[0]?.hash;
  if (!hash) throw new Error(`Upload image échoué (${file.name})`);
  return { kind: "image", hash, fileName: file.name };
}

type CampaignClone = GraphError & {
  id?: string;
  name?: string;
  objective?: string;
  special_ad_categories?: string[];
  buying_type?: string;
  bid_strategy?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  smart_promotion_type?: string;
  promoted_object?: Record<string, unknown>;
};

type AdsetClone = GraphError & {
  id?: string;
  name?: string;
  campaign_id?: string;
  targeting?: Record<string, unknown>;
  optimization_goal?: string;
  billing_event?: string;
  bid_amount?: number;
  bid_strategy?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  promoted_object?: Record<string, unknown>;
  destination_type?: string;
  attribution_spec?: unknown;
  pacing_type?: string[];
  start_time?: string;
  end_time?: string;
  is_dynamic_creative?: boolean;
  dsa_beneficiary?: string;
  dsa_payor?: string;
  instagram_actor_id?: string;
};

type AdClone = GraphError & {
  id?: string;
  name?: string;
  creative?: {
    id?: string;
    object_story_spec?: { page_id?: string; instagram_actor_id?: string };
    asset_feed_spec?: { call_to_action_types?: string[]; link_urls?: Array<{ website_url?: string; display_url?: string }> };
  };
};

export type CreateAdsInput = {
  accountId: string;
  sourceCampaignId?: string;
  sourceAdsetId?: string;
  sourceAdId?: string;
  createNewCampaign: boolean;
  createNewAdset: boolean;
  adsetPerUpload: boolean;
  autoDivide: number | null;
  adNamePattern: string;
  headlines: string[];
  bodies: string[];
  descriptions: string[];
  websiteUrl: string;
  displayUrl: string;
  cta: string;
  flexible: boolean;
  paused: boolean;
  aiGenerated: boolean;
  enhancements: Record<string, boolean>;
  media: UploadedMedia[];
};

function enroll(enhancements: Record<string, boolean>) {
  const spec: Record<string, { enroll_status: "OPT_IN" }> = {};
  for (const [key, on] of Object.entries(enhancements)) {
    if (on) spec[key] = { enroll_status: "OPT_IN" };
  }
  return spec;
}

function fileStem(name: string) {
  return name.replace(/\.[^.]+$/, "").slice(0, 80);
}

function adName(pattern: string, fileName: string, campaign: string, adset: string, index: number) {
  const raw = (pattern || "{file}").replaceAll("{file}", fileStem(fileName)).replaceAll("{campaign}", campaign).replaceAll("{adset}", adset).replaceAll("{n}", String(index + 1));
  return raw.slice(0, 200) || `Ad ${index + 1}`;
}

export async function createAdsFromTemplate(input: CreateAdsInput) {
  if (!input.media.length) throw new Error("Ajoute au moins un média");
  if (!input.sourceAdsetId && !input.sourceCampaignId) {
    throw new Error("Sélectionne une campagne / un ad set source pour copier les settings");
  }

  const act = input.accountId.startsWith("act_") ? input.accountId : `act_${input.accountId}`;
  const token = await resolveToken(act);
  const status = input.paused ? "PAUSED" : "ACTIVE";

  const sourceCampaign = input.sourceCampaignId
    ? await graphGet<CampaignClone>(
        `${input.sourceCampaignId}?fields=id,name,objective,special_ad_categories,buying_type,bid_strategy,daily_budget,lifetime_budget,smart_promotion_type,promoted_object`,
        token
      )
    : null;
  if (sourceCampaign?.error) throw new Error(sourceCampaign.error.message);

  const sourceAdset = input.sourceAdsetId
    ? await graphGet<AdsetClone>(
        `${input.sourceAdsetId}?fields=id,name,campaign_id,targeting,optimization_goal,billing_event,bid_amount,bid_strategy,daily_budget,lifetime_budget,promoted_object,destination_type,attribution_spec,pacing_type,start_time,end_time,is_dynamic_creative,dsa_beneficiary,dsa_payor,instagram_actor_id`,
        token
      )
    : null;
  if (sourceAdset?.error) throw new Error(sourceAdset.error.message);

  const sourceAd = input.sourceAdId
    ? await graphGet<AdClone>(
        `${input.sourceAdId}?fields=id,name,creative{object_story_spec,asset_feed_spec}`,
        token
      )
    : null;
  if (sourceAd?.error) throw new Error(sourceAd.error.message);

  let pageId = sourceAd?.creative?.object_story_spec?.page_id;
  if (!pageId && sourceAdset?.promoted_object && typeof sourceAdset.promoted_object === "object") {
    const promoted = sourceAdset.promoted_object as { page_id?: string };
    pageId = promoted.page_id;
  }
  if (!pageId) {
    const pages = await graphGet<GraphError & { data?: Array<{ id: string }> }>(`${act}/promote_pages?fields=id&limit=5`, token);
    pageId = pages.data?.[0]?.id;
  }
  if (!pageId) throw new Error("Impossible de trouver la Facebook Page liée à ce compte / cet ad set.");

  const instagramActorId =
    sourceAd?.creative?.object_story_spec?.instagram_actor_id || sourceAdset?.instagram_actor_id;

  const website =
    input.websiteUrl ||
    sourceAd?.creative?.asset_feed_spec?.link_urls?.[0]?.website_url ||
    "";
  if (!website) throw new Error("Website URL manquante");

  const cta =
    input.cta ||
    sourceAd?.creative?.asset_feed_spec?.call_to_action_types?.[0] ||
    "SHOP_NOW";

  let campaignId = sourceAdset?.campaign_id || input.sourceCampaignId;
  let campaignName = sourceCampaign?.name || "Campaign";
  if (input.createNewCampaign) {
    if (!sourceCampaign?.objective) throw new Error("La campagne source n’a pas d’objective copiable");
    const created = await graphPost<GraphError & { id?: string }>(`${act}/campaigns`, token, {
      name: `${sourceCampaign.name} · copy`,
      objective: sourceCampaign.objective,
      special_ad_categories: sourceCampaign.special_ad_categories || [],
      status,
      ...(sourceCampaign.buying_type ? { buying_type: sourceCampaign.buying_type } : {}),
      ...(sourceCampaign.bid_strategy ? { bid_strategy: sourceCampaign.bid_strategy } : {}),
      ...(sourceCampaign.daily_budget ? { daily_budget: sourceCampaign.daily_budget } : {}),
      ...(sourceCampaign.lifetime_budget && !sourceCampaign.daily_budget
        ? { lifetime_budget: sourceCampaign.lifetime_budget }
        : {}),
      ...(sourceCampaign.promoted_object ? { promoted_object: sourceCampaign.promoted_object } : {}),
    });
    if (created.error || !created.id) throw new Error(created.error?.message || "Création campagne refusée");
    campaignId = created.id;
    campaignName = `${sourceCampaign.name} · copy`;
  }
  if (!campaignId) throw new Error("Campagne cible manquante");

  const headlines = input.headlines.map((t) => t.trim()).filter(Boolean);
  const bodies = input.bodies.map((t) => t.trim()).filter(Boolean);
  const descriptions = input.descriptions.map((t) => t.trim()).filter(Boolean);
  const groups: UploadedMedia[][] = input.adsetPerUpload
    ? input.media.map((item) => [item])
    : input.autoDivide && input.autoDivide > 0
      ? chunk(input.media, input.autoDivide)
      : [input.media];

  const createdAds: Array<{ id: string; name: string }> = [];
  const createdAdsets: string[] = [];

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    let adsetId = input.sourceAdsetId;
    let adsetName = sourceAdset?.name || "Ad set";
    if (input.createNewAdset || input.adsetPerUpload || groups.length > 1) {
      if (!sourceAdset?.targeting || !sourceAdset.optimization_goal || !sourceAdset.billing_event) {
        throw new Error("L’ad set source n’a pas de targeting / optimization copiable");
      }
      const created = await graphPost<GraphError & { id?: string }>(`${act}/adsets`, token, {
        name: groups.length > 1 ? `${sourceAdset.name} · ${g + 1}` : `${sourceAdset.name} · copy`,
        campaign_id: campaignId,
        targeting: sourceAdset.targeting,
        optimization_goal: sourceAdset.optimization_goal,
        billing_event: sourceAdset.billing_event,
        status,
        ...(sourceAdset.daily_budget ? { daily_budget: sourceAdset.daily_budget } : {}),
        ...(sourceAdset.lifetime_budget && !sourceAdset.daily_budget
          ? { lifetime_budget: sourceAdset.lifetime_budget }
          : {}),
        ...(sourceAdset.bid_amount ? { bid_amount: sourceAdset.bid_amount } : {}),
        ...(sourceAdset.bid_strategy ? { bid_strategy: sourceAdset.bid_strategy } : {}),
        ...(sourceAdset.promoted_object ? { promoted_object: sourceAdset.promoted_object } : {}),
        ...(sourceAdset.destination_type ? { destination_type: sourceAdset.destination_type } : {}),
        ...(sourceAdset.attribution_spec ? { attribution_spec: sourceAdset.attribution_spec } : {}),
        ...(sourceAdset.pacing_type ? { pacing_type: sourceAdset.pacing_type } : {}),
        ...(sourceAdset.dsa_beneficiary ? { dsa_beneficiary: sourceAdset.dsa_beneficiary } : {}),
        ...(sourceAdset.dsa_payor ? { dsa_payor: sourceAdset.dsa_payor } : {}),
        ...(sourceAdset.instagram_actor_id ? { instagram_actor_id: sourceAdset.instagram_actor_id } : {}),
        is_dynamic_creative: Boolean(input.flexible || sourceAdset.is_dynamic_creative),
      });
      if (created.error || !created.id) throw new Error(created.error?.message || "Création ad set refusée");
      adsetId = created.id;
      adsetName = groups.length > 1 ? `${sourceAdset.name} · ${g + 1}` : `${sourceAdset.name} · copy`;
      createdAdsets.push(adsetId);
    }
    if (!adsetId) throw new Error("Ad set cible manquant");

    for (let i = 0; i < group.length; i++) {
      const media = group[i];
      const name = adName(input.adNamePattern, media.fileName, campaignName, adsetName, createdAds.length);
      const images = media.kind === "image" && media.hash ? [{ hash: media.hash }] : [];
      const videos = media.kind === "video" && media.videoId ? [{ video_id: media.videoId }] : [];
      const featureSpec = enroll(input.enhancements);
      const creativeBody: Record<string, unknown> = {
        name: `${name} · creative`,
        object_story_spec: {
          page_id: pageId,
          ...(instagramActorId ? { instagram_user_id: instagramActorId } : {}),
        },
        asset_feed_spec: {
          ad_formats: [media.kind === "video" ? "SINGLE_VIDEO" : "SINGLE_IMAGE"],
          ...(images.length ? { images } : {}),
          ...(videos.length ? { videos } : {}),
          titles: (headlines.length ? headlines : [fileStem(media.fileName)]).map((text) => ({ text })),
          bodies: (bodies.length ? bodies : [" "]).map((text) => ({ text })),
          descriptions: (descriptions.length ? descriptions : [""]).map((text) => ({ text })),
          call_to_action_types: [cta],
          link_urls: [{ website_url: website, ...(input.displayUrl ? { display_url: input.displayUrl } : {}) }],
        },
        ...(Object.keys(featureSpec).length
          ? { degrees_of_freedom_spec: { creative_features_spec: featureSpec } }
          : {}),
        ...(input.aiGenerated ? { contextual_multi_ads: { enroll_status: "OPT_IN" } } : {}),
      };

      let creative = await graphPost<GraphError & { id?: string }>(`${act}/adcreatives`, token, creativeBody);
      if (creative.error && creativeBody.degrees_of_freedom_spec) {
        delete creativeBody.degrees_of_freedom_spec;
        creative = await graphPost<GraphError & { id?: string }>(`${act}/adcreatives`, token, creativeBody);
      }
      if (creative.error || !creative.id) {
        throw new Error(creative.error?.message || `Creative refusée (${media.fileName})`);
      }

      const ad = await graphPost<GraphError & { id?: string }>(`${act}/ads`, token, {
        name,
        adset_id: adsetId,
        creative: { creative_id: creative.id },
        status,
      });
      if (ad.error || !ad.id) throw new Error(ad.error?.message || `Ad refusée (${media.fileName})`);
      createdAds.push({ id: ad.id, name });
    }
  }

  invalidateTreeCache();
  return {
    ads: createdAds,
    adsetCount: createdAdsets.length || 1,
    campaignId,
  };
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
