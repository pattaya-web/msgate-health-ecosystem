import { discoverAdAccounts, getMetaConfigWithExtras } from "@/lib/meta/client";
import { centsToUnits, graphGet, graphPost, graphPostForm, unitsToCents, type GraphError } from "@/lib/meta/graph";
import { resolveToken } from "@/lib/meta/token";
import { invalidateTreeCache } from "@/lib/meta/tree";
import {
  formatAdName,
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
    allPages<{ id: string; name: string; status: string; objective?: string; daily_budget?: string }>(
      `${act}/campaigns?fields=id,name,status,objective,daily_budget&limit=200`,
      token
    ),
    allPages<{ id: string; name: string; status: string; campaign_id: string; daily_budget?: string }>(
      `${act}/adsets?fields=id,name,status,campaign_id,daily_budget&limit=300`,
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
      dailyBudget: centsToUnits(row.daily_budget),
    })) as PickerCampaign[],
    adsets: adsets.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      campaignId: row.campaign_id,
      dailyBudget: centsToUnits(row.daily_budget),
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
  /** Premier numéro pour {n} / {nn} (ex. 6 si l'ad set a déjà S 01 à S 05). */
  startNumber?: number;
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
  /** Budget journalier (devise du compte) du ou des nouveaux ad sets — ou de la nouvelle campagne si elle porte le budget (CBO). Vide = celui du modèle. */
  dailyBudget?: number | null;
  /** Nom du nouvel ad set (« · 2, · 3 » ajoutés s'il y en a plusieurs). Vide = « <modèle> · copy ». */
  adsetName?: string;
};

function enroll(enhancements: Record<string, boolean>) {
  const spec: Record<string, { enroll_status: "OPT_IN" }> = {};
  for (const [key, on] of Object.entries(enhancements)) {
    if (on) spec[key] = { enroll_status: "OPT_IN" };
  }
  return spec;
}

/**
 * Le message de Meta en clair : son titre et son explication pour l'utilisateur
 * (« Autorisation de Page manquante : … ») plutôt que « Invalid parameter ».
 */
function metaMessage(error: GraphError["error"] | undefined) {
  if (!error) return "réponse vide de Meta.";
  const detail = error as { message: string; error_user_title?: string; error_user_msg?: string };
  if (detail.error_user_title || detail.error_user_msg) return `${detail.error_user_title ?? ""}${detail.error_user_title && detail.error_user_msg ? " : " : ""}${detail.error_user_msg ?? ""}`;
  return detail.message;
}

function fileStem(name: string) {
  return name.replace(/\.[^.]+$/, "").slice(0, 80);
}

function adName(pattern: string, fileName: string, campaign: string, adset: string, index: number, start?: number) {
  return formatAdName(pattern, { fileName, campaign, adset, index, start });
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
  // Une publication existante garde son propre lien : l'URL n'est exigée que pour les fichiers.
  if (!website && input.media.some((item) => item.kind !== "post")) throw new Error("Website URL manquante");
  for (const item of input.media) {
    if (item.kind === "post" && !/^\d+(_\d+)?$/.test(item.postId ?? "")) throw new Error(`Post ID illisible : « ${item.postId ?? ""} »`);
  }

  const cta =
    input.cta ||
    sourceAd?.creative?.asset_feed_spec?.call_to_action_types?.[0] ||
    "SHOP_NOW";

  /*
   * Un ad set en créa dynamique (DCO) n'accepte qu'UNE pub chez Meta. On ne le
   * force plus (avant, l'option « Flexible » le faisait et la 2e créa était
   * refusée) : la cible est dynamique seulement si l'ad set modèle l'est.
   */
  const targetDynamic = Boolean(sourceAdset?.is_dynamic_creative);
  const perAdset = input.adsetPerUpload ? 1 : input.autoDivide && input.autoDivide > 0 ? input.autoDivide : input.media.length;
  if (targetDynamic && perAdset > 1) {
    throw new Error(
      "L'ad set modèle est en créa dynamique : Meta n'y accepte qu'une seule pub. Choisis un ad set modèle classique, ou active « un ad set par fichier »."
    );
  }

  const plannedCampaignName = input.createNewCampaign && sourceCampaign?.name ? `${sourceCampaign.name} · copy` : sourceCampaign?.name || "Campaign";

  const headlines = input.headlines.map((t) => t.trim()).filter(Boolean);
  const bodies = input.bodies.map((t) => t.trim()).filter(Boolean);
  const descriptions = input.descriptions.map((t) => t.trim()).filter(Boolean);
  const groups: UploadedMedia[][] = input.adsetPerUpload
    ? input.media.map((item) => [item])
    : input.autoDivide && input.autoDivide > 0
      ? chunk(input.media, input.autoDivide)
      : [input.media];
  const makesAdsets = input.createNewAdset || input.adsetPerUpload || groups.length > 1;
  const chosenName = input.adsetName?.trim().slice(0, 200);
  const adsetNameOf = (g: number) =>
    makesAdsets
      ? chosenName
        ? groups.length > 1
          ? `${chosenName} · ${g + 1}`
          : chosenName
        : groups.length > 1
          ? `${sourceAdset?.name} · ${g + 1}`
          : `${sourceAdset?.name} · copy`
      : sourceAdset?.name || "Ad set";
  // Le budget choisi : sur la campagne si elle le porte (CBO), sinon sur chaque nouvel ad set (ABO).
  const budget = input.dailyBudget && Number.isFinite(input.dailyBudget) && input.dailyBudget > 0 ? unitsToCents(input.dailyBudget) : null;
  const campaignBudget = Boolean(sourceCampaign?.daily_budget || sourceCampaign?.lifetime_budget);
  if (makesAdsets && (!sourceAdset?.targeting || !sourceAdset.optimization_goal || !sourceAdset.billing_event)) {
    throw new Error("L’ad set source n’a pas de targeting / optimization copiable");
  }

  /*
   * 1. Toutes les créas d'abord. Une créa seule n'est diffusée nulle part : si
   * Meta en refuse une (droits sur la Page, lien manquant…), on s'arrête avant
   * d'avoir créé la moindre campagne, le moindre ad set ou la moindre pub —
   * plus d'ad set allumé et vide comme le 01/11/2026.
   */
  const planned: Array<{ group: number; media: UploadedMedia; name: string; creativeId: string }> = [];
  let index = 0;
  for (let g = 0; g < groups.length; g++) {
    for (const media of groups[g]) {
      const name = adName(input.adNamePattern, media.fileName, plannedCampaignName, adsetNameOf(g), index, input.startNumber);
      index += 1;
      const images = media.kind === "image" && media.hash ? [{ hash: media.hash }] : [];
      const videos = media.kind === "video" && media.videoId ? [{ video_id: media.videoId }] : [];
      const featureSpec = enroll(input.enhancements);
      if (media.kind === "post" && media.postId) {
        // Publication existante : la pub la reprend telle quelle (texte, visuel, likes, commentaires).
        const storyId = media.postId.includes("_") ? media.postId : `${pageId}_${media.postId}`;
        const postBody: Record<string, unknown> = {
          name: `${name} · creative`,
          object_story_id: storyId,
          ...(instagramActorId ? { instagram_user_id: instagramActorId } : {}),
        };
        if (Object.keys(featureSpec).length) postBody.degrees_of_freedom_spec = { creative_features_spec: featureSpec };
        let creative = await graphPost<GraphError & { id?: string }>(`${act}/adcreatives`, token, postBody);
        // Meta peut refuser les options Advantage+ ou le compte Instagram sur un post existant : on réessaie sans.
        for (const key of ["degrees_of_freedom_spec", "instagram_user_id"]) {
          if (!creative.error || !(key in postBody)) continue;
          delete postBody[key];
          creative = await graphPost<GraphError & { id?: string }>(`${act}/adcreatives`, token, postBody);
        }
        if (creative.error || !creative.id) {
          throw new Error(`Post ${storyId} refusé par Meta — ${metaMessage(creative.error)} Rien n'a été créé dans le compte.`);
        }
        planned.push({ group: g, media, name, creativeId: creative.id });
        continue;
      }
      const titleList = headlines.length ? headlines : [fileStem(media.fileName)];
      const bodyList = bodies.length ? bodies : [" "];
      /*
       * Plusieurs titres / textes / descriptions : le mode « degrés de liberté »
       * (asset_feed_spec), comme le Gestionnaire Meta. Un seul de chaque :
       * Meta refuse ce mode (« au moins un champ doit avoir plus d'une
       * ressource »), on fait alors une créa classique (link_data).
       */
      const multiText = titleList.length > 1 || bodyList.length > 1 || descriptions.length > 1;
      const simpleImage = media.kind === "image" && media.hash && !multiText && !targetDynamic;
      const creativeBody: Record<string, unknown> = simpleImage
        ? {
            name: `${name} · creative`,
            object_story_spec: {
              page_id: pageId,
              ...(instagramActorId ? { instagram_user_id: instagramActorId } : {}),
              link_data: {
                link: website,
                image_hash: media.hash,
                message: bodyList[0].trim(),
                name: titleList[0],
                ...(descriptions[0] ? { description: descriptions[0] } : {}),
                call_to_action: { type: cta, value: { link: website } },
              },
            },
          }
        : {
            name: `${name} · creative`,
            object_story_spec: {
              page_id: pageId,
              ...(instagramActorId ? { instagram_user_id: instagramActorId } : {}),
              // Comme le Gestionnaire Meta : le lien (et l'image) dans la publication elle-même, sinon « Le champ link est requis ».
              ...(media.kind === "image" && media.hash ? { link_data: { link: website, image_hash: media.hash, call_to_action: { type: cta } } } : {}),
            },
            asset_feed_spec: {
              ad_formats: [media.kind === "video" ? "SINGLE_VIDEO" : "SINGLE_IMAGE"],
              ...(images.length ? { images } : {}),
              ...(videos.length ? { videos } : {}),
              titles: titleList.map((text) => ({ text })),
              bodies: bodyList.map((text) => ({ text })),
              ...(descriptions.length ? { descriptions: descriptions.map((text) => ({ text })) } : {}),
              call_to_action_types: [cta],
              link_urls: [{ website_url: website, ...(input.displayUrl ? { display_url: input.displayUrl } : {}) }],
              // Hors créa dynamique, Meta exige ce mode pour plusieurs titres / textes sur une même pub.
              ...(targetDynamic || !multiText ? {} : { optimization_type: "DEGREES_OF_FREEDOM" }),
            },
          };
      if (Object.keys(featureSpec).length) creativeBody.degrees_of_freedom_spec = { creative_features_spec: featureSpec };
      if (input.aiGenerated) creativeBody.contextual_multi_ads = { enroll_status: "OPT_IN" };

      let creative = await graphPost<GraphError & { id?: string }>(`${act}/adcreatives`, token, creativeBody);
      if (creative.error && creativeBody.degrees_of_freedom_spec) {
        delete creativeBody.degrees_of_freedom_spec;
        creative = await graphPost<GraphError & { id?: string }>(`${act}/adcreatives`, token, creativeBody);
      }
      if (creative.error || !creative.id) {
        throw new Error(`Créa refusée par Meta (${media.fileName}) — ${metaMessage(creative.error)} Rien n'a été créé dans le compte.`);
      }
      planned.push({ group: g, media, name, creativeId: creative.id });
    }
  }

  // 2. La campagne (si demandée), puis les ad sets et les pubs.
  let campaignId = sourceAdset?.campaign_id || input.sourceCampaignId;
  const campaignName = plannedCampaignName;
  if (input.createNewCampaign) {
    if (!sourceCampaign?.objective) throw new Error("La campagne source n’a pas d’objective copiable");
    const created = await graphPost<GraphError & { id?: string }>(`${act}/campaigns`, token, {
      name: `${sourceCampaign.name} · copy`,
      objective: sourceCampaign.objective,
      special_ad_categories: sourceCampaign.special_ad_categories || [],
      status,
      ...(sourceCampaign.buying_type ? { buying_type: sourceCampaign.buying_type } : {}),
      ...(sourceCampaign.bid_strategy ? { bid_strategy: sourceCampaign.bid_strategy } : {}),
      ...(sourceCampaign.daily_budget ? { daily_budget: budget ?? sourceCampaign.daily_budget } : {}),
      ...(sourceCampaign.lifetime_budget && !sourceCampaign.daily_budget
        ? { lifetime_budget: sourceCampaign.lifetime_budget }
        : {}),
      ...(sourceCampaign.promoted_object ? { promoted_object: sourceCampaign.promoted_object } : {}),
    });
    if (created.error || !created.id) throw new Error(`Campagne refusée par Meta — ${metaMessage(created.error)}`);
    campaignId = created.id;
  }
  if (!campaignId) throw new Error("Campagne cible manquante");
  void campaignName;

  const createdAds: Array<{ id: string; name: string }> = [];
  const createdAdsets: string[] = [];

  for (let g = 0; g < groups.length; g++) {
    let adsetId = input.sourceAdsetId;
    if (makesAdsets && sourceAdset) {
      const created = await graphPost<GraphError & { id?: string }>(`${act}/adsets`, token, {
        name: adsetNameOf(g),
        campaign_id: campaignId,
        targeting: sourceAdset.targeting,
        optimization_goal: sourceAdset.optimization_goal,
        billing_event: sourceAdset.billing_event,
        status,
        // Budget de l'ad set : celui choisi dans l'uploader, sinon celui du modèle (jamais si la campagne porte le budget).
        ...(!campaignBudget && (budget || sourceAdset.daily_budget) ? { daily_budget: budget ?? sourceAdset.daily_budget } : {}),
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
        is_dynamic_creative: targetDynamic,
      });
      if (created.error || !created.id) throw new Error(`Ad set refusé par Meta — ${metaMessage(created.error)}`);
      adsetId = created.id;
      createdAdsets.push(adsetId);
    }
    if (!adsetId) throw new Error("Ad set cible manquant");

    for (const row of planned.filter((item) => item.group === g)) {
      const ad = await graphPost<GraphError & { id?: string }>(`${act}/ads`, token, {
        name: row.name,
        adset_id: adsetId,
        creative: { creative_id: row.creativeId },
        status,
      });
      if (ad.error || !ad.id) throw new Error(`Pub refusée par Meta (${row.media.fileName}) — ${metaMessage(ad.error)}`);
      createdAds.push({ id: ad.id, name: row.name });
    }
  }

  invalidateTreeCache();
  return {
    ads: createdAds,
    adsetCount: createdAdsets.length || 1,
    campaignId,
  };
}

type CreativeCopy = GraphError & {
  creative?: {
    title?: string;
    body?: string;
    call_to_action_type?: string;
    object_story_spec?: {
      link_data?: { name?: string; message?: string; description?: string; link?: string; call_to_action?: { type?: string } };
      video_data?: { title?: string; message?: string; link_description?: string; call_to_action?: { type?: string; value?: { link?: string } } };
    };
    asset_feed_spec?: {
      titles?: Array<{ text?: string }>;
      bodies?: Array<{ text?: string }>;
      descriptions?: Array<{ text?: string }>;
      call_to_action_types?: string[];
      link_urls?: Array<{ website_url?: string; display_url?: string }>;
    };
  };
};

/**
 * Les textes d'une pub existante (titres, textes principaux, descriptions,
 * lien, bouton) : l'uploader s'en sert pour « se calquer » sur une créa qui
 * tourne déjà. Lecture seule.
 */
export async function readAdCopy(adId: string) {
  const token = await resolveToken(adId);
  const body = await graphGet<CreativeCopy>(
    `${adId}?fields=creative{title,body,call_to_action_type,object_story_spec,asset_feed_spec}`,
    token
  );
  if (body.error) throw new Error(body.error.message);
  const creative = body.creative ?? {};
  const feed = creative.asset_feed_spec;
  const link = creative.object_story_spec?.link_data;
  const video = creative.object_story_spec?.video_data;
  const texts = (rows?: Array<{ text?: string }>) => (rows ?? []).map((row) => row.text?.trim() ?? "").filter(Boolean);
  const unique = (rows: Array<string | undefined>) => [...new Set(rows.map((row) => row?.trim() ?? "").filter(Boolean))];
  return {
    headlines: unique([...texts(feed?.titles), link?.name, video?.title, creative.title]),
    bodies: unique([...texts(feed?.bodies), link?.message, video?.message, creative.body]),
    descriptions: unique([...texts(feed?.descriptions), link?.description, video?.link_description]),
    websiteUrl: feed?.link_urls?.[0]?.website_url || link?.link || video?.call_to_action?.value?.link || "",
    displayUrl: feed?.link_urls?.[0]?.display_url || "",
    cta: feed?.call_to_action_types?.[0] || link?.call_to_action?.type || video?.call_to_action?.type || creative.call_to_action_type || "",
  };
}

/**
 * L'aperçu Meta d'une publication existante (Post ID), tel qu'il sortira en
 * pub dans le fil mobile : de quoi vérifier qu'on a collé le bon post avant
 * de créer quoi que ce soit. Lecture seule — Meta renvoie un lien d'iframe.
 */
export async function previewPost(accountId: string, postId: string) {
  const id = postId.trim();
  if (!/^\d+(_\d+)?$/.test(id)) throw new Error("Post ID illisible");
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const token = await resolveToken(act);
  let storyId = id;
  if (!id.includes("_")) {
    const pages = await graphGet<GraphError & { data?: Array<{ id: string }> }>(`${act}/promote_pages?fields=id&limit=1`, token);
    const pageId = pages.data?.[0]?.id;
    if (!pageId) throw new Error("Page Facebook du compte introuvable : colle le Post ID complet (idPage_idPost).");
    storyId = `${pageId}_${id}`;
  }
  const creative = encodeURIComponent(JSON.stringify({ object_story_id: storyId }));
  const body = await graphGet<GraphError & { data?: Array<{ body?: string }> }>(
    `${act}/generatepreviews?ad_format=MOBILE_FEED_STANDARD&creative=${creative}`,
    token
  );
  if (body.error) throw new Error(`Post introuvable pour ce compte pub : vérifie le Post ID (Meta : ${metaMessage(body.error)})`);
  const src = body.data?.[0]?.body?.match(/src="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  if (!src || !/^https:\/\/[^/]*facebook\.com\//.test(src)) throw new Error("Meta n'a pas renvoyé d'aperçu pour ce post.");
  return { storyId, src };
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
