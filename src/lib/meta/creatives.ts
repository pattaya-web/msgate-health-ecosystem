import { graphBatch, type GraphError } from "@/lib/meta/graph";
import { resolveToken } from "@/lib/meta/token";
import type { CreativeAsset, CreativeDetail, EntityStatus } from "@/lib/meta/types";

/**
 * Everything the ads screen needs to show and export a creative: the copy in
 * all its variants, the destination, the post it renders from, and the media
 * files themselves.
 *
 * Two Graph quirks shape this module:
 *  - A video node cannot be read directly (`/{video_id}` is refused by the
 *    app), but the account library edge `act_x/advideos` happily returns the
 *    same objects with their mp4 source. So sources are resolved through a
 *    per-account library index instead of one lookup per video.
 *  - Images sometimes arrive as a bare hash; `act_x/adimages?hashes=[…]` turns
 *    those into the original upload, which is the 1080-wide file we want.
 */

/* ------------------------------------------------------------------ *
 * Raw Graph shapes
 * ------------------------------------------------------------------ */

type TextVariant = { text?: string };

type CallToAction = { type?: string; value?: { link?: string } };

type LinkData = {
  link?: string;
  message?: string;
  name?: string;
  description?: string;
  caption?: string;
  picture?: string;
  image_hash?: string;
  call_to_action?: CallToAction;
  child_attachments?: Array<{ link?: string; picture?: string; image_hash?: string; name?: string }>;
};

type VideoData = {
  video_id?: string;
  message?: string;
  title?: string;
  link_description?: string;
  image_url?: string;
  image_hash?: string;
  call_to_action?: CallToAction;
};

type AssetFeedSpec = {
  bodies?: TextVariant[];
  titles?: TextVariant[];
  descriptions?: TextVariant[];
  link_urls?: Array<{ website_url?: string; display_url?: string }>;
  call_to_action_types?: string[];
  images?: Array<{ hash?: string; url?: string }>;
  videos?: Array<{ video_id?: string; thumbnail_url?: string; thumbnail_hash?: string }>;
};

type RawCreative = {
  id?: string;
  name?: string;
  body?: string;
  title?: string;
  link_url?: string;
  call_to_action_type?: string;
  url_tags?: string;
  image_url?: string;
  image_hash?: string;
  thumbnail_url?: string;
  video_id?: string;
  object_story_id?: string;
  effective_object_story_id?: string;
  instagram_permalink_url?: string;
  object_story_spec?: { page_id?: string; link_data?: LinkData; video_data?: VideoData };
  asset_feed_spec?: AssetFeedSpec;
};

type RawAd = GraphError & {
  id?: string;
  name?: string;
  status?: EntityStatus;
  effective_status?: string;
  account_id?: string;
  campaign_id?: string;
  adset_id?: string;
  campaign?: { name?: string };
  adset?: { name?: string };
  preview_shareable_link?: string;
  creative?: RawCreative;
};

type RawVideo = { id?: string; source?: string; picture?: string };

type RawImage = {
  hash?: string;
  url?: string;
  permalink_url?: string;
  width?: number;
  height?: number;
  original_width?: number;
  original_height?: number;
};

type Paged<T> = GraphError & { data?: T[] };

const CREATIVE_FIELDS = [
  "id",
  "name",
  "body",
  "title",
  "link_url",
  "call_to_action_type",
  "url_tags",
  "image_url",
  "image_hash",
  "thumbnail_url",
  "video_id",
  "object_story_id",
  "effective_object_story_id",
  "instagram_permalink_url",
  "object_story_spec",
  "asset_feed_spec",
].join(",");

const AD_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "account_id",
  "campaign_id",
  "adset_id",
  "campaign{name}",
  "adset{name}",
  "preview_shareable_link",
  `creative{${CREATIVE_FIELDS}}`,
].join(",");

/* ------------------------------------------------------------------ *
 * Caches
 *
 * Creatives barely change once an ad is live, and the media libraries change
 * even less, so both are memoised for the lifetime of a work session.
 * ------------------------------------------------------------------ */

type Cached<T> = { at: number; value: T };

type CreativeStore = {
  details: Map<string, Cached<CreativeDetail>>;
  videos: Map<string, Cached<Map<string, RawVideo>>>;
  images: Map<string, Cached<RawImage>>;
};

const globalRef = globalThis as typeof globalThis & {
  __msgateMetaCreatives?: CreativeStore;
  __msgateCreativeUrlPref?: number;
};

const store: CreativeStore = (globalRef.__msgateMetaCreatives ??= {
  details: new Map(),
  videos: new Map(),
  images: new Map(),
});

/** Bump when asset URL preference changes so stale low-res entries drop. */
const ASSET_URL_PREF = 3;
if (globalRef.__msgateCreativeUrlPref !== ASSET_URL_PREF) {
  globalRef.__msgateCreativeUrlPref = ASSET_URL_PREF;
  store.details.clear();
}

const DETAIL_TTL = 10 * 60_000;
const LIBRARY_TTL = 30 * 60_000;

const fresh = <T>(entry: Cached<T> | undefined, ttl: number) =>
  entry && Date.now() - entry.at < ttl ? entry.value : null;

export function invalidateCreativeCache() {
  store.details.clear();
}

/* ------------------------------------------------------------------ *
 * Parsing helpers
 * ------------------------------------------------------------------ */

/** Primary value first, then the dynamic variants, deduped and trimmed. */
function textVariants(primary: string | undefined, variants: TextVariant[] | undefined) {
  const out: string[] = [];
  const push = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  };
  push(primary);
  for (const variant of variants || []) push(variant.text);
  return out;
}

function resolveLink(creative: RawCreative) {
  const link = creative.object_story_spec?.link_data;
  const video = creative.object_story_spec?.video_data;
  return (
    link?.link ||
    link?.call_to_action?.value?.link ||
    video?.call_to_action?.value?.link ||
    creative.link_url ||
    creative.asset_feed_spec?.link_urls?.[0]?.website_url ||
    link?.child_attachments?.[0]?.link ||
    null
  );
}

/** Post-ID ads carry no link_data at all; the URL then only lives in the copy. */
function linkFromText(texts: string[]) {
  for (const text of texts) {
    const match = text.match(/https?:\/\/[^\s)"']+/);
    if (match) return match[0].replace(/[.,;]$/, "");
  }
  return null;
}

function resolveCta(creative: RawCreative) {
  return (
    creative.call_to_action_type ||
    creative.object_story_spec?.link_data?.call_to_action?.type ||
    creative.object_story_spec?.video_data?.call_to_action?.type ||
    creative.asset_feed_spec?.call_to_action_types?.[0] ||
    null
  );
}

/** Page posts live at facebook.com/{page}/posts/{post}. */
function permalinkFor(storyId: string | null) {
  if (!storyId) return null;
  const [page, post] = storyId.split("_");
  return page && post ? `https://www.facebook.com/${page}/posts/${post}` : null;
}

/* ------------------------------------------------------------------ *
 * Media libraries
 * ------------------------------------------------------------------ */

/** One request per account returns every video with its downloadable source. */
async function loadVideoLibraries(token: string, accountIds: string[]) {
  const missing = accountIds.filter((id) => !fresh(store.videos.get(id), LIBRARY_TTL));
  if (missing.length) {
    const results = await graphBatch<Paged<RawVideo>>(
      token,
      missing.map((id) => ({
        key: id,
        relativeUrl: `act_${id}/advideos?fields=id,source,picture&limit=200`,
      }))
    );
    for (const result of results) {
      const map = new Map<string, RawVideo>();
      for (const video of result.body?.data || []) {
        if (video.id) map.set(String(video.id), video);
      }
      store.videos.set(result.key, { at: Date.now(), value: map });
    }
  }

  const merged = new Map<string, RawVideo>();
  for (const id of accountIds) {
    for (const [videoId, video] of store.videos.get(id)?.value || []) merged.set(videoId, video);
  }
  return merged;
}

/** Hashes are resolved per account, in one request per account. */
async function loadImages(token: string, byAccount: Map<string, Set<string>>) {
  const requests: Array<{ key: string; relativeUrl: string }> = [];

  for (const [accountId, hashes] of byAccount) {
    const unknown = [...hashes].filter((hash) => !fresh(store.images.get(hash), LIBRARY_TTL));
    if (!unknown.length) continue;
    // 40 hashes keeps the URL well inside the Graph length limit.
    for (let offset = 0; offset < unknown.length; offset += 40) {
      const slice = unknown.slice(offset, offset + 40);
      requests.push({
        key: `${accountId}:${offset}`,
        relativeUrl: `act_${accountId}/adimages?fields=hash,url,permalink_url,width,height,original_width,original_height&hashes=${encodeURIComponent(
          JSON.stringify(slice)
        )}`,
      });
    }
  }

  if (!requests.length) return;

  const results = await graphBatch<Paged<RawImage>>(token, requests);
  for (const result of results) {
    for (const image of result.body?.data || []) {
      if (image.hash) store.images.set(image.hash, { at: Date.now(), value: image });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

function buildAssets(
  creative: RawCreative,
  videos: Map<string, RawVideo>,
): CreativeAsset[] {
  const assets: CreativeAsset[] = [];
  const seen = new Set<string>();

  const story = creative.object_story_spec;
  const poster =
    story?.video_data?.image_url || creative.image_url || creative.thumbnail_url || null;

  const addVideo = (videoId: string | undefined, thumbnail?: string | null) => {
    if (!videoId || seen.has(videoId)) return;
    seen.add(videoId);
    const known = videos.get(String(videoId));
    assets.push({
      id: String(videoId),
      kind: "video",
      url: known?.source || null,
      thumbnail: known?.picture || thumbnail || poster,
      width: null,
      height: null,
    });
  };

  const addImage = (hash: string | undefined, url: string | undefined) => {
    const key = hash || url;
    if (!key || seen.has(key)) return;
    seen.add(key);
    const known = hash ? fresh(store.images.get(hash), LIBRARY_TTL) : null;
    // permalink_url = original upload (sharp). Graph `url` is often a smaller CDN variant.
    // Client displays via /api/meta/asset so hotlink blocks on permalink are avoided.
    const full = known?.permalink_url || known?.url || url || null;
    if (!full) return;
    assets.push({
      id: key,
      kind: "image",
      url: full,
      thumbnail: known?.url || url || full,
      width: known?.original_width || known?.width || null,
      height: known?.original_height || known?.height || null,
    });
  };

  addVideo(creative.video_id, creative.thumbnail_url);
  addVideo(story?.video_data?.video_id, story?.video_data?.image_url);
  for (const video of creative.asset_feed_spec?.videos || []) {
    addVideo(video.video_id, video.thumbnail_url);
  }

  // A video ad's still image is its poster, not a separate creative.
  const hasVideo = assets.some((asset) => asset.kind === "video");
  if (!hasVideo) {
    addImage(creative.image_hash, creative.image_url);
    addImage(story?.link_data?.image_hash, story?.link_data?.picture);
    for (const child of story?.link_data?.child_attachments || []) {
      addImage(child.image_hash, child.picture);
    }
    for (const image of creative.asset_feed_spec?.images || []) addImage(image.hash, image.url);
  }

  // Meta often exposes the same video under two ids, only one of which has a
  // source; downloadable assets first so previews and downloads pick that one.
  return [...assets.filter((asset) => asset.url), ...assets.filter((asset) => !asset.url)];
}

/** Hashes worth resolving before the assets are built. */
function collectHashes(creative: RawCreative) {
  const hashes = new Set<string>();
  const story = creative.object_story_spec;
  if (creative.image_hash) hashes.add(creative.image_hash);
  if (story?.link_data?.image_hash) hashes.add(story.link_data.image_hash);
  for (const child of story?.link_data?.child_attachments || []) {
    if (child.image_hash) hashes.add(child.image_hash);
  }
  for (const image of creative.asset_feed_spec?.images || []) {
    if (image.hash) hashes.add(image.hash);
  }
  return hashes;
}

function toDetail(ad: RawAd, videos: Map<string, RawVideo>): CreativeDetail {
  const creative = ad.creative || {};
  const story = creative.object_story_spec;
  const linkData = story?.link_data;
  const videoData = story?.video_data;
  const postId = creative.effective_object_story_id || creative.object_story_id || null;

  const bodies = textVariants(
    creative.body || linkData?.message || videoData?.message,
    creative.asset_feed_spec?.bodies
  );

  return {
    adId: String(ad.id),
    adName: ad.name || "",
    status: (ad.status as EntityStatus) || "PAUSED",
    effectiveStatus: ad.effective_status || "",
    accountId: ad.account_id || "",
    campaignId: ad.campaign_id || "",
    campaignName: ad.campaign?.name || "",
    adsetId: ad.adset_id || "",
    adsetName: ad.adset?.name || "",
    creativeId: creative.id || null,
    creativeName: creative.name || null,
    bodies,
    titles: textVariants(
      creative.title || linkData?.name || videoData?.title,
      creative.asset_feed_spec?.titles
    ),
    descriptions: textVariants(
      linkData?.description || videoData?.link_description,
      creative.asset_feed_spec?.descriptions
    ),
    callToAction: resolveCta(creative),
    link: resolveLink(creative) || linkFromText(bodies),
    urlTags: creative.url_tags || null,
    postId,
    permalink: permalinkFor(postId),
    instagramPermalink: creative.instagram_permalink_url || null,
    previewLink: ad.preview_shareable_link || null,
    assets: buildAssets(creative, videos),
  };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function fetchCreatives(
  adIds: string[],
  options: { force?: boolean } = {}
): Promise<{ creatives: CreativeDetail[]; errors: string[] }> {
  const unique = [...new Set(adIds.filter(Boolean))];
  const errors: string[] = [];
  const byId = new Map<string, CreativeDetail>();

  const pending: string[] = [];
  for (const id of unique) {
    const cached = options.force ? null : fresh(store.details.get(id), DETAIL_TTL);
    if (cached) byId.set(id, cached);
    else pending.push(id);
  }

  if (pending.length) {
    // Every ad is reachable through exactly one token; group so each batch is
    // a single authenticated round-trip.
    const byToken = new Map<string, string[]>();
    await Promise.all(
      pending.map(async (id) => {
        try {
          const token = await resolveToken(id);
          byToken.set(token, [...(byToken.get(token) || []), id]);
        } catch {
          errors.push(`Publicité ${id} : aucun token Meta n'y a accès.`);
        }
      })
    );

    await Promise.all(
      [...byToken.entries()].map(async ([token, ids]) => {
        const results = await graphBatch<RawAd>(
          token,
          ids.map((id) => ({ key: id, relativeUrl: `${id}?fields=${AD_FIELDS}` }))
        );

        const ads: RawAd[] = [];
        for (const result of results) {
          if (result.error || !result.body) {
            errors.push(`Publicité ${result.key} : ${result.error || "réponse vide"}`);
            continue;
          }
          ads.push(result.body);
        }
        if (!ads.length) return;

        const accountIds = [...new Set(ads.map((ad) => ad.account_id).filter(Boolean))] as string[];

        const hashesByAccount = new Map<string, Set<string>>();
        for (const ad of ads) {
          if (!ad.account_id || !ad.creative) continue;
          const hashes = hashesByAccount.get(ad.account_id) || new Set<string>();
          for (const hash of collectHashes(ad.creative)) hashes.add(hash);
          hashesByAccount.set(ad.account_id, hashes);
        }

        const [videos] = await Promise.all([
          loadVideoLibraries(token, accountIds),
          loadImages(token, hashesByAccount),
        ]);

        for (const ad of ads) {
          const detail = toDetail(ad, videos);
          store.details.set(detail.adId, { at: Date.now(), value: detail });
          byId.set(detail.adId, detail);
        }
      })
    );
  }

  // Preserve the order the caller asked for so the UI stays stable.
  return { creatives: unique.map((id) => byId.get(id)).filter(Boolean) as CreativeDetail[], errors };
}
