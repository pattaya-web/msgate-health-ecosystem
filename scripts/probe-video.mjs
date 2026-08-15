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

const tokens = (env.META_ACCESS_TOKENS || "").split(",").map((t) => t.trim()).filter(Boolean);
const token = tokens[3];
const V = env.META_API_VERSION || "v21.0";
const G = "https://graph.facebook.com";

const get = async (path, tk = token) => {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${G}/${V}/${path}${sep}access_token=${encodeURIComponent(tk)}`);
  return res.json();
};

const PAGE = "113463648471422";
const MISSING_VIDEO = "866864129553109";
const STORY = "113463648471422_920036031161394";

const pages = await get("me/accounts?fields=id,name,access_token&limit=50");
console.log("### me/accounts");
console.log(
  pages.error
    ? `error: ${pages.error.message}`
    : (pages.data || []).map((p) => `${p.id} ${p.name} token=${p.access_token ? "yes" : "no"}`).join("\n")
);

const pageToken = (pages.data || []).find((p) => String(p.id) === PAGE)?.access_token;
if (pageToken) {
  console.log("\n### video with page token");
  console.log(JSON.stringify(await get(`${MISSING_VIDEO}?fields=id,source,picture,permalink_url`, pageToken)).slice(0, 600));

  console.log("\n### story attachments with page token");
  console.log(JSON.stringify(await get(`${STORY}?fields=attachments{media,media_type,type,url,target,subattachments}`, pageToken)).slice(0, 1200));
}

console.log("\n### page token via node");
const direct = await get(`${PAGE}?fields=id,name,access_token`);
console.log(direct.error ? `error: ${direct.error.message}` : `token=${direct.access_token ? "yes" : "no"}`);
