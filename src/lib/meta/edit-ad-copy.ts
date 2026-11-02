import { graphGet, graphPost, type GraphError } from "@/lib/meta/graph";
import { resolveToken } from "@/lib/meta/token";
import { invalidateCreativeCache } from "@/lib/meta/creatives";

/**
 * Modifier l'ad copy d'une pub qui tourne. Meta ne change pas le texte d'une
 * créa existante : on recrée la créa avec les mêmes visuels, lien et bouton,
 * et les nouveaux textes, puis on la met sur la même pub (comme le
 * Gestionnaire Meta). Meta repasse la pub en examen ; une pub créée depuis une
 * publication existante (Post ID) garde le texte du post et ne se modifie pas ici.
 */

export type AdCopyPatch = { headlines: string[]; bodies: string[]; descriptions: string[] };

type Spec = Record<string, unknown>;
type RawCreative = {
  id?: string;
  name?: string;
  object_story_id?: string;
  object_story_spec?: Spec & { link_data?: Spec; video_data?: Spec };
  asset_feed_spec?: Spec & { images?: Array<Spec>; videos?: Array<Spec> };
  degrees_of_freedom_spec?: Spec;
  url_tags?: string;
};

const clean = (rows: string[]) => rows.map((row) => row.trim()).filter(Boolean).slice(0, 5);

function metaMessage(error: GraphError["error"] | undefined) {
  if (!error) return "réponse vide de Meta.";
  const detail = error as { message: string; error_user_title?: string; error_user_msg?: string };
  return detail.error_user_msg || detail.error_user_title || detail.message;
}

/** `dryRun` : crée la nouvelle créa pour vérifier que Meta l'accepte, puis la supprime sans toucher à la pub. */
export async function updateAdCopy(adId: string, patch: AdCopyPatch, options: { dryRun?: boolean } = {}) {
  const headlines = clean(patch.headlines);
  const bodies = clean(patch.bodies);
  const descriptions = clean(patch.descriptions);
  if (!bodies.length && !headlines.length) throw new Error("Mets au moins un texte principal ou un titre.");

  const token = await resolveToken(adId);
  const ad = await graphGet<GraphError & { account_id?: string; name?: string; creative?: RawCreative }>(
    `${encodeURIComponent(adId)}?fields=account_id,name,creative{id,name,object_story_id,object_story_spec,asset_feed_spec,degrees_of_freedom_spec,url_tags}`,
    token
  );
  if (ad.error || !ad.creative || !ad.account_id) throw new Error(`Pub illisible : ${metaMessage(ad.error)}`);
  const source = ad.creative;
  if (!source.object_story_spec && source.object_story_id) {
    throw new Error("Cette pub reprend une publication existante (Post ID) : son texte est celui du post et ne se modifie pas ici.");
  }
  if (!source.object_story_spec) throw new Error("Créa sans contenu modifiable.");

  const story: Spec = { ...source.object_story_spec };
  let feed: Spec | undefined = source.asset_feed_spec ? { ...source.asset_feed_spec } : undefined;

  if (feed) {
    // Plusieurs textes : on remplace les listes du « asset feed », on garde visuels, lien et bouton.
    feed.titles = (headlines.length ? headlines : [String(ad.name ?? "")]).map((text) => ({ text }));
    feed.bodies = (bodies.length ? bodies : [" "]).map((text) => ({ text }));
    if (descriptions.length) feed.descriptions = descriptions.map((text) => ({ text }));
    else delete feed.descriptions;
    // Ce que Meta renvoie en lecture mais refuse en création.
    if (Array.isArray(feed.images)) feed.images = feed.images.map((image) => (image.hash ? { hash: image.hash } : image));
    if (Array.isArray(feed.videos)) {
      feed.videos = feed.videos.map((video) => ({
        video_id: video.video_id,
        ...(video.thumbnail_hash ? { thumbnail_hash: video.thumbnail_hash } : video.thumbnail_url ? { thumbnail_url: video.thumbnail_url } : {}),
      }));
    }
    if (story.link_data) {
      const link = { ...(story.link_data as Spec) };
      delete link.message;
      delete link.name;
      delete link.description;
      if (link.image_hash) delete link.picture;
      story.link_data = link;
    }
  } else if (story.link_data) {
    const link = { ...(story.link_data as Spec) };
    if (bodies[0]) link.message = bodies[0];
    if (headlines[0]) link.name = headlines[0];
    if (descriptions[0]) link.description = descriptions[0];
    else delete link.description;
    if (link.image_hash) delete link.picture;
    story.link_data = link;
  } else if (story.video_data) {
    const video = { ...(story.video_data as Spec) };
    if (bodies[0]) video.message = bodies[0];
    if (headlines[0]) video.title = headlines[0];
    if (descriptions[0]) video.link_description = descriptions[0];
    else delete video.link_description;
    if (video.image_hash) delete video.image_url;
    story.video_data = video;
  } else {
    throw new Error("Format de créa non pris en charge (ni image, ni vidéo, ni textes multiples).");
  }

  const act = `act_${ad.account_id}`;
  const body: Spec = {
    name: `${source.name ?? ad.name ?? "Créa"} · texte modifié`.slice(0, 200),
    object_story_spec: story,
    ...(feed ? { asset_feed_spec: feed } : {}),
    ...(source.degrees_of_freedom_spec ? { degrees_of_freedom_spec: source.degrees_of_freedom_spec } : {}),
    ...(source.url_tags ? { url_tags: source.url_tags } : {}),
  };
  let created = await graphPost<GraphError & { id?: string }>(`${act}/adcreatives`, token, body);
  // Les options Advantage+ ou un mode « degrés de liberté » devenu inutile (un seul texte) peuvent être refusés : on réessaie sans.
  if (created.error && body.degrees_of_freedom_spec) {
    delete body.degrees_of_freedom_spec;
    created = await graphPost<GraphError & { id?: string }>(`${act}/adcreatives`, token, body);
  }
  if (created.error && feed && "optimization_type" in feed) {
    feed = { ...feed };
    delete feed.optimization_type;
    body.asset_feed_spec = feed;
    created = await graphPost<GraphError & { id?: string }>(`${act}/adcreatives`, token, body);
  }
  if (created.error || !created.id) throw new Error(`Meta refuse la nouvelle créa : ${metaMessage(created.error)}`);
  if (options.dryRun) {
    await fetch(`https://graph.facebook.com/v21.0/${created.id}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" }).catch(() => null);
    return { adId, creativeId: created.id, previousCreativeId: source.id ?? null, adName: ad.name ?? "", accountId: ad.account_id, dryRun: true };
  }

  const updated = await graphPost<GraphError & { success?: boolean }>(encodeURIComponent(adId), token, { creative: { creative_id: created.id } });
  if (updated.error) throw new Error(`Meta refuse de changer la créa de la pub : ${metaMessage(updated.error)}`);
  invalidateCreativeCache();
  return { adId, creativeId: created.id, previousCreativeId: source.id ?? null, adName: ad.name ?? "", accountId: ad.account_id };
}
