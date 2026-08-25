// Génère le process IBO · MID · BANK · SHOP en PDF anglais, prêt à envoyer.
//
//   node scripts/process-pdf.mjs [sortie.pdf]
//
// Le rendu passe par Chromium (déjà installé pour l'aspiration Whop) : pas de
// dépendance PDF supplémentaire, et la mise en page est celle d'un navigateur.
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const OUT = process.argv[2] || "MSGate-Process-IBO-MID-BANK-SHOP.pdf";

/**
 * Traduction du tableau maître. Le contenu suit carte pour carte celui de
 * l'outil : rien n'est ajouté, rien n'est réordonné.
 */
const BOARD = [
  {
    title: "IBO",
    subtitle: "Independent Business Owner",
    cards: [
      {
        title: "IBO process",
        tone: "yellow",
        lines: [
          "Receive the contact's documents",
          "Verify the documents",
          "Organise the file under that person's name",
          "Pre-check on ProfitPay.org (≈ 2 months)",
          "Create professional emails (@merchant…)",
          "Sync the details to Airtable",
        ],
      },
      {
        title: "Bank page opening — window 10–12",
        tone: "green",
        text: "Start the bank page opening within the 10–12 window.",
      },
      {
        title: "Final task — banks",
        tone: "yellow",
        lines: [
          "Apply / open: Slash · Wise · Revolut · Relay",
          "Lili Bank · Found · Zen",
        ],
        warning: "Total fees to pay: $150",
      },
      {
        title: "Bank file (e.g. Chase)",
        tone: "tan",
        lines: [
          "Prepare the BDM if needed",
          "Open the business accounts",
          "Set up the shop / site if required",
          "Obtain the bank letter",
          "Confirm account access",
        ],
      },
      {
        title: "Bank account opened",
        tone: "green",
        text: "Have at least 2 bank accounts before scaling the MID.",
      },
    ],
  },
  {
    title: "MID",
    subtitle: "Processor · Merchant Number",
    cards: [
      {
        title: "What a MID is",
        tone: "yellow",
        lines: ["MID = Merchant ID → collects the orders", "Opening a MID = IBO + ISO + Bank page"],
      },
      {
        title: "ISO contacts",
        tone: "purple",
        lines: [
          "John Stevenson — john@gatewaysmadeeasy.com",
          "Doug — @therydos.xyz",
          "MAC ISO — BFMacSource",
          "Nicole — @nicolepierce",
          "Jonathan — jb@paymentcloudinc.com",
        ],
      },
      {
        title: "Application + underwriting",
        tone: "green",
        text: "File submitted to the ISO → underwriting → MID decision.",
      },
      {
        title: "MID approved",
        tone: "green",
        lines: ["Set up RDR / Ethoca protection", "Connect it to the CRM", "Start sending volume through it"],
      },
      {
        title: "MID declined / closed",
        tone: "red",
        lines: ["Open other MIDs", "New IBOs / LLCs", "Do not stay stuck"],
      },
    ],
  },
  {
    title: "BANK",
    subtitle: "Structure · Backup · Closure",
    cards: [
      {
        title: "ISO → IBO LLC → Bank",
        tone: "tan",
        lines: [
          "Chain: ISO → IBO LLC → Bank account",
          "Refunds and chargebacks tie the MID to the bank",
        ],
      },
      {
        title: "Banks — 2 minimum",
        tone: "green",
        lines: ["Bank 1 — primary", "Bank 2 — operating", "Bank 3 — backup", "Bank 4 — reserve"],
      },
      {
        title: "Keep the account alive",
        tone: "orange",
        lines: ["Business spending: office / Shopify", "Email subscriptions", "Canva and other tools"],
        note: "An active, credible account.",
      },
      {
        title: "Payment / invoice documents",
        tone: "neutral",
        lines: [
          "Contract",
          "Unique invoice number",
          "Legal name",
          "Example: Payment INV-2305-145 — E-commerce consulting",
        ],
      },
      {
        title: "If the bank closes",
        tone: "red",
        lines: [
          "Do not cut the PSP traffic",
          "Replace the bank linked to the MID",
          "Notify the ISO (email / Telegram)",
          "Move the volume to the backup",
        ],
      },
      {
        title: "LLC ecom system",
        tone: "green",
        lines: ["Primary + operating", "Ads = payment reserve"],
      },
    ],
  },
  {
    title: "SHOP",
    subtitle: "Acquisition · Volume · Membership",
    cards: [
      { title: "Acquisition", tone: "blue", lines: ["Meta Ads", "TikTok Ads"] },
      {
        title: "Send volume",
        tone: "blue",
        text: "Volume goes on a MID connected to the CRM, once it is protected (RDR / Ethoca).",
      },
      {
        title: "Offer + membership",
        tone: "purple",
        lines: ["Profiles / creatives", "Offer + membership", "Tie the metrics to volume"],
      },
    ],
  },
];

const TONES = {
  yellow: "#f5c518",
  green: "#2f9e64",
  red: "#d64545",
  amber: "#e8973a",
  purple: "#8b5cf6",
  blue: "#3b82f6",
  neutral: "#94a3b8",
  tan: "#b08968",
  orange: "#ef7c39",
};

const escape = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cardHtml(card) {
  const parts = [];
  if (card.text) parts.push(`<p>${escape(card.text)}</p>`);
  if (card.lines) {
    parts.push(`<ul>${card.lines.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>`);
  }
  if (card.note) parts.push(`<p class="note">${escape(card.note)}</p>`);
  if (card.warning) parts.push(`<p class="warn">${escape(card.warning)}</p>`);

  return `<article class="card" style="--tone:${TONES[card.tone] ?? TONES.neutral}">
      <h3>${escape(card.title)}</h3>
      ${parts.join("")}
    </article>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Process</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: "Segoe UI", Inter, system-ui, sans-serif;
    color: #10202e; font-size: 10.5pt; line-height: 1.45;
  }
  header { border-bottom: 2px solid #10202e; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 20pt; margin: 0 0 4px; letter-spacing: -0.3px; }
  header p { margin: 0; color: #5b6b7a; font-size: 9.5pt; }
  section { break-inside: avoid; margin-bottom: 18px; }
  .col-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
  .col-head h2 { font-size: 13pt; margin: 0; letter-spacing: 0.5px; }
  .col-head span { color: #5b6b7a; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.6px; }
  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .card {
    break-inside: avoid; border: 1px solid #e2e8f0; border-left: 4px solid var(--tone);
    border-radius: 6px; padding: 9px 11px; background: #fff;
  }
  .card h3 { font-size: 10pt; margin: 0 0 5px; letter-spacing: 0.2px; }
  .card p { margin: 0 0 4px; }
  .card ul { margin: 0; padding-left: 15px; }
  .card li { margin-bottom: 2px; }
  .note { color: #5b6b7a; font-style: italic; margin-top: 4px !important; }
  .warn { color: #b4341f; font-weight: 600; margin-top: 5px !important; }
  footer { margin-top: 12px; border-top: 1px solid #e2e8f0; padding-top: 8px;
           color: #8394a3; font-size: 8.5pt; }
</style></head>
<body>
  <header>
    <h1>IBO · MID · BANK · SHOP</h1>
    <p>End-to-end operating process — from opening the structure to sending volume.</p>
  </header>

  ${BOARD.map(
    (column) => `<section>
      <div class="col-head"><h2>${escape(column.title)}</h2><span>${escape(column.subtitle)}</span></div>
      <div class="cards">${column.cards.map(cardHtml).join("")}</div>
    </section>`
  ).join("")}

  <footer>Internal process document — not for redistribution.</footer>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
const pdf = await page.pdf({ format: "A4", printBackground: true });
await browser.close();

writeFileSync(OUT, pdf);
console.log(`✓ ${OUT} — ${(pdf.length / 1024).toFixed(0)} Ko`);
