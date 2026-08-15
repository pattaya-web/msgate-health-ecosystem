import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, "")];
    })
);

const tokens = (env.META_ACCESS_TOKENS || env.META_ACCESS_TOKEN || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

const V = env.META_API_VERSION || "v21.0";
const G = "https://graph.facebook.com";

const get = async (path, token) => {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${G}/${V}/${path}${sep}access_token=${encodeURIComponent(token)}`);
  return res.json();
};

const CREATIVE_FIELDS = [
  "id",
  "name",
  "video_id",
  "image_url",
  "image_hash",
  "object_type",
  "object_story_spec",
  "asset_feed_spec",
].join(",");

for (const [index, token] of tokens.entries()) {
  const accounts = await get("me/adaccounts?fields=account_id,name&limit=10", token);
  if (accounts.error) continue;

  for (const account of accounts.data || []) {
    const ads = await get(
      `act_${account.account_id}/ads?fields=id,name,creative{${CREATIVE_FIELDS}}&limit=50`,
      token
    );
    if (ads.error || !ads.data?.length) continue;

    const withVideo = ads.data.find((ad) => {
      const c = ad.creative || {};
      return (
        c.video_id ||
        c.object_story_spec?.video_data ||
        (c.asset_feed_spec?.videos || []).length > 0
      );
    });
    if (!withVideo) continue;

    console.log(`===== token#${index + 1} act_${account.account_id} =====`);
    console.log(JSON.stringify(withVideo, null, 2).slice(0, 4000));

    const videoId =
      withVideo.creative.video_id ||
      withVideo.creative.object_story_spec?.video_data?.video_id ||
      withVideo.creative.asset_feed_spec?.videos?.[0]?.video_id;

    if (videoId) {
      console.log("\n--- video object ---");
      console.log(
        JSON.stringify(
          await get(`${videoId}?fields=id,source,picture,permalink_url,title,length`, token),
          null,
          2
        ).slice(0, 2500)
      );
    }

    const hash = withVideo.creative.image_hash;
    if (hash) {
      console.log("\n--- adimages by hash ---");
      console.log(
        JSON.stringify(
          await get(
            `act_${account.account_id}/adimages?fields=hash,url,permalink_url,width,height,original_width,original_height&hashes=${encodeURIComponent(JSON.stringify([hash]))}`,
            token
          ),
          null,
          2
        ).slice(0, 1500)
      );
    }

    console.log("\n--- previews (DESKTOP_FEED_STANDARD) ---");
    console.log(
      JSON.stringify(
        await get(`${withVideo.id}/previews?ad_format=MOBILE_FEED_STANDARD`, token),
        null,
        2
      ).slice(0, 1200)
    );

    process.exit(0);
  }
}
console.log("no video ad found");
