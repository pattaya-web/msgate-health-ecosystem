export type ProcessCardTone =
  | "yellow"
  | "green"
  | "red"
  | "amber"
  | "purple"
  | "blue"
  | "neutral"
  | "tan"
  | "orange";

export type ProcessCard = {
  id: string;
  title: string;
  body: string;
  tone: ProcessCardTone;
};

export type ProcessColumn = {
  id: string;
  title: string;
  subtitle?: string;
  cards: ProcessCard[];
};

export type ProcessBoard = {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  columns: ProcessColumn[];
};

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

const now = () => new Date().toISOString();

/** Whiteboard exact — 4 colonnes de cases comme ton board Miro */
export function createEcosystemWhiteboard(): ProcessBoard {
  return {
    id: "process-ecosystem-master",
    name: "Process IBO · MID · BANK · SHOP",
    description: "Whiteboard opérationnel — cases éditables",
    created_at: now(),
    updated_at: now(),
    columns: [
      {
        id: "col-ibo",
        title: "IBO",
        subtitle: "INDEPENDANT BUSINESS OWNER",
        cards: [
          {
            id: uid("c"),
            title: "PROCESSUS IBO",
            tone: "yellow",
            body: [
              "• Recevoir les documents contact",
              "• Vérifier les documents",
              "• Organiser le dossier au nom de la personne",
              "• Pré-check ProfitPay.org (≈ 2 mois)",
              "• Créer emails pro (@merchant…)",
              "• Sync infos → Airtable",
            ].join("\n"),
          },
          {
            id: uid("c"),
            title: "OUVERTURE BANK PAGE 10–12",
            tone: "green",
            body: "Lancer l’ouverture de bank page\n(fenêtre 10–12)",
          },
          {
            id: uid("c"),
            title: "DERNIÈRE TÂCHE — BANKS",
            tone: "yellow",
            body: [
              "Postuler / ouvrir :",
              "Slash · Wise · Revolut · Relay",
              "Lili Bank · Found · Zen",
              "",
              "⚠ Total taxe à payer : 150$",
            ].join("\n"),
          },
          {
            id: uid("c"),
            title: "DOSSIER BANK (ex. Chase)",
            tone: "tan",
            body: [
              "• Préparer BDM si besoin",
              "• Ouvrir comptes pro",
              "• Setup shop / site si requis",
              "• Obtenir bank letter",
              "• Accès comptes confirmés",
            ].join("\n"),
          },
          {
            id: uid("c"),
            title: "COMPTE EN BANQUE OUVERT",
            tone: "green",
            body: "Avoir 2 banks account min\navant de scaler le MID",
          },
        ],
      },
      {
        id: "col-mid",
        title: "MID",
        subtitle: "PROCESSEUR · MERCHANT NUMBER",
        cards: [
          {
            id: uid("c"),
            title: "DÉFINITION MID",
            tone: "yellow",
            body: [
              "MID = Merchant ID",
              "→ encaisser les commandes",
              "",
              "Ouverture MID =",
              "IBO + ISO + Bank Page",
            ].join("\n"),
          },
          {
            id: uid("c"),
            title: "ISO CONTACTS",
            tone: "purple",
            body: [
              "John Stevenson",
              "john@gatewaysmadeeasy.com",
              "",
              "Doug — @therydos.xyz",
              "MAC ISO — BFMacSource",
              "Nicole — @nicolepierce",
              "Jonathan",
              "jb@paymentcloudinc.com",
            ].join("\n"),
          },
          {
            id: uid("c"),
            title: "APPLICATION + UNDERWRITING",
            tone: "green",
            body: "Dépôt dossier ISO\n→ underwriting\n→ décision MID",
          },
          {
            id: uid("c"),
            title: "MID APPROUVÉ",
            tone: "green",
            body: [
              "→ Protection RDR / Ethoca",
              "→ Connecter au CRM",
              "→ Envoyer du volume dessus",
            ].join("\n"),
          },
          {
            id: uid("c"),
            title: "MID DECLINE / CLOSE",
            tone: "red",
            body: [
              "→ Ouvrir d’autres MID",
              "→ Nouveaux IBO / LLC",
              "→ Ne pas rester bloqué",
            ].join("\n"),
          },
        ],
      },
      {
        id: "col-bank",
        title: "BANK",
        subtitle: "STRUCTURE · BACKUP · FERMETURE",
        cards: [
          {
            id: uid("c"),
            title: "ISO → IBO LLC → BANK",
            tone: "tan",
            body: "Chaîne :\nISO → IBO LLC → BANK ACCOUNT\n\nRefund / Chargeback\nliés MID ↔ Bank",
          },
          {
            id: uid("c"),
            title: "BANKS — 2 MINIMUM",
            tone: "green",
            body: [
              "BANK 1 — primary",
              "BANK 2 — operating",
              "BANK 3 — BACKUP",
              "BANK 4 — réserve",
            ].join("\n"),
          },
          {
            id: uid("c"),
            title: "FAIRE VIVRE LE COMPTE",
            tone: "orange",
            body: [
              "Dépenses business :",
              "• Office / Shopify",
              "• Abos email",
              "• Canva / outils",
              "Compte actif & crédible",
            ].join("\n"),
          },
          {
            id: uid("c"),
            title: "DOCS PAIEMENT / FACTURE",
            tone: "neutral",
            body: [
              "• Contrat",
              "• N° facture unique",
              "• Legal name",
              "• Ex : Payment INV-2305-145",
              "  E-commerce consulting",
            ].join("\n"),
          },
          {
            id: uid("c"),
            title: "SI BANK CLOSED",
            tone: "red",
            body: [
              "• Ne pas couper le trafic PSP",
              "• Remplacer bank liée au MID",
              "• Prévenir ISO (mail / telegram)",
              "• Basculer volume → backup",
            ].join("\n"),
          },
          {
            id: uid("c"),
            title: "LLC ECOM SYSTEM",
            tone: "green",
            body: "PRIMARY + OPERATING\nADS = réserve paiement",
          },
        ],
      },
      {
        id: "col-shop",
        title: "SHOP",
        subtitle: "ACQUISITION · VOLUME · MEMBERSHIP",
        cards: [
          {
            id: uid("c"),
            title: "ACQUISITION",
            tone: "blue",
            body: "ACQUISITION\n→ Meta Ads\n→ TikTok Ads",
          },
          {
            id: uid("c"),
            title: "ENVOYER DU VOLUME",
            tone: "blue",
            body: "Volume sur MID connecté CRM\nune fois protégé\n(RDR / Ethoca)",
          },
          {
            id: uid("c"),
            title: "OFF + MEMBERSHIP",
            tone: "purple",
            body: [
              "• Profils / créas",
              "• OFF + MEMBERSHIP",
              "• Lier les métriques",
              "  pour le volume",
            ].join("\n"),
          },
        ],
      },
    ],
  };
}

export function createEmptyProcess(name: string): ProcessBoard {
  return {
    id: uid("process"),
    name: name.trim() || "Nouveau process",
    description: "",
    created_at: now(),
    updated_at: now(),
    columns: [
      {
        id: uid("col"),
        title: "IBO",
        cards: [
          {
            id: uid("c"),
            title: "NOUVELLE CASE",
            body: "Écris ici…",
            tone: "yellow",
          },
        ],
      },
    ],
  };
}

export const CARD_TONE_CLASS: Record<ProcessCardTone, string> = {
  yellow: "border-2 border-amber-300 bg-[#FFF3B0] text-amber-950 shadow-[2px_3px_0_rgba(180,140,20,0.25)]",
  green:
    "border-2 border-emerald-500 bg-[#B8F0C8] text-emerald-950 shadow-[2px_3px_0_rgba(16,120,60,0.25)]",
  red: "border-2 border-rose-500 bg-[#FFB4B4] text-rose-950 shadow-[2px_3px_0_rgba(160,40,40,0.25)]",
  amber:
    "border-2 border-orange-400 bg-[#FFD8A8] text-orange-950 shadow-[2px_3px_0_rgba(180,90,20,0.25)]",
  orange:
    "border-2 border-orange-500 bg-[#FFC078] text-orange-950 shadow-[2px_3px_0_rgba(180,90,20,0.25)]",
  purple:
    "border-2 border-violet-400 bg-[#E0C3FC] text-violet-950 shadow-[2px_3px_0_rgba(90,40,140,0.22)]",
  blue: "border-2 border-sky-400 bg-[#A5D8FF] text-sky-950 shadow-[2px_3px_0_rgba(20,80,140,0.22)]",
  neutral:
    "border-2 border-slate-300 bg-white text-slate-800 shadow-[2px_3px_0_rgba(15,23,42,0.12)]",
  tan: "border-2 border-stone-400 bg-[#E7D5C0] text-stone-900 shadow-[2px_3px_0_rgba(80,60,40,0.2)]",
};
