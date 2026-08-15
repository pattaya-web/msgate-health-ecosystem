// Measure the Phoenix rate limit (burst size + refill rate).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

function loadEnv() {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnv();
const base = (env.PHOENIX_BASE_URL || "").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hit(customerId) {
  const url = new URL(base + "/phxcrm/transaction-history");
  url.searchParams.set("CustomerId", String(customerId));
  url.searchParams.set("StartDateTime", "2020-01-01T00:00:00.000Z");
  const res = await fetch(url.toString(), {
    headers: {
      partnerId: env.PHOENIX_PARTNER_ID,
      partnerToken: env.PHOENIX_PARTNER_TOKEN,
      "request-id": randomUUID(),
      Authorization: `Bearer ${env.PHOENIX_BEARER_TOKEN}`,
      Accept: "application/json",
    },
  });
  const headers = {};
  for (const [k, v] of res.headers) {
    if (/rate|limit|retry|remaining|reset/i.test(k)) headers[k] = v;
  }
  return { status: res.status, headers };
}

console.log("cooling down 65s so the limiter window resets…");
await sleep(65000);

const cid = 4864407;
console.log("\n=== burst test: sequential, no delay ===");
const t0 = Date.now();
let ok = 0;
let firstBlockAt = null;
for (let i = 1; i <= 120; i++) {
  const r = await hit(cid);
  if (r.status === 200) ok++;
  else if (firstBlockAt === null) {
    firstBlockAt = i;
    console.log(
      `  first 429 on request #${i} after ${Date.now() - t0}ms (ok so far ${ok}) headers=${JSON.stringify(r.headers)}`
    );
  }
  if (i % 20 === 0) console.log(`  #${i}: ok=${ok}, elapsed=${Date.now() - t0}ms`);
  if (firstBlockAt && i - firstBlockAt > 25) break;
}
console.log(`burst: ${ok} successes, first block at #${firstBlockAt}, ${Date.now() - t0}ms`);

console.log("\n=== recovery probe: 1 req every 2s for 40s ===");
for (let i = 0; i < 20; i++) {
  await sleep(2000);
  const r = await hit(cid);
  process.stdout.write(`${r.status} `);
}
console.log();

console.log("\n=== paced test: 1 req every 1.2s, 30 requests ===");
let paced = 0;
for (let i = 0; i < 30; i++) {
  const r = await hit(cid);
  if (r.status === 200) paced++;
  await sleep(1200);
}
console.log(`paced 1.2s: ${paced}/30 ok`);
