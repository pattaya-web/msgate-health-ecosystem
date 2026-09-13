"use client";

import { createContext, createElement, useContext, type ElementType, type KeyboardEvent, type ClipboardEvent, type FocusEvent } from "react";
import type { BankPage, BankPageDraft } from "@/lib/bank-pages/types";
import { themeOf } from "@/lib/bank-pages/types";
import { cn } from "@/lib/utils";

/**
 * La page agence, telle que la banque la verra — et, en mode édition, telle
 * que l'opérateur la corrige : chaque texte se clique et se modifie sur place,
 * le résultat est identique au pixel près à la page publique.
 */

type EditContext = {
  editable: boolean;
  onEdit?: (path: string, value: string) => void;
};

const Edit = createContext<EditContext>({ editable: false });

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

/**
 * Un texte de la page. Lecture seule sur la page publique ; en édition, un
 * élément `contentEditable` qui remonte sa nouvelle valeur quand on le quitte.
 * Le contenu est posé via innerHTML pour que React ne se batte pas avec le
 * curseur pendant la frappe, et soit remis au propre après validation.
 */
function T({ path, value, as = "span", className, multiline = false }: { path: string; value: string; as?: ElementType; className?: string; multiline?: boolean }) {
  const ctx = useContext(Edit);
  if (!ctx.editable) return createElement(as, { className }, value);
  return createElement(as, {
    className: cn(className, "bank-edit"),
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    "data-edit": path,
    dangerouslySetInnerHTML: { __html: escapeHtml(value) },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      const next = event.currentTarget.innerText.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      if (next !== value) ctx.onEdit?.(path, next);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.currentTarget.innerHTML = escapeHtml(value);
        event.currentTarget.blur();
      } else if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.currentTarget.blur();
      }
    },
    onPaste: (event: ClipboardEvent<HTMLElement>) => {
      /* Le presse-papiers arrive en texte brut : pas de styles étrangers dans la page. */
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, multiline ? text : text.replace(/\s*\n\s*/g, " "));
    },
  });
}

/* Textes de la page qui ne sont pas des champs du formulaire : un jeu de
   défauts, remplaçables un par un depuis l'aperçu et gardés dans `texts`. */
export const BANK_DEFAULT_TEXTS: Record<string, string> = {
  cta: "Get in touch",
  "pillar.0.tag": "US DTC",
  "pillar.0.title": "Operators on the keys",
  "pillar.0.body": "No telephone game. The strategist who plans is the buyer who ships weekly changes.",
  "pillar.1.tag": "US DTC",
  "pillar.1.title": "Margin is the scoreboard",
  "pillar.1.body": "We judge campaigns on contribution margin and cash efficiency — screenshots don’t pay rent.",
  "pillar.2.tag": "US DTC",
  "pillar.2.title": "Creative with a cadence",
  "pillar.2.body": "Angles, hooks, and kill criteria. Winners get budget; losers get cut — on a fixed rhythm.",
  "services.eyebrow": "Services",
  "services.title": "Acquisition levers we run",
  "services.intro": "Pick Meta, TikTok, store conversion, or brand systems — alone or as one stack.",
  "results.eyebrow": "Results",
  "results.title": "Numbers that survive a P&L review",
  "results.intro": "Illustrative outcomes from acquisition work — ROAS held while scaling, margin recovered, creative systems that compound.",
  "about.eyebrow": "About",
  "about.title": "A performance partner built on clarity",
  "about.p1": "{brand} is the growth brand of {legal}. We exist for one reason: help DTC brands buy customers on Meta and TikTok without guessing — and without hiding behind vanity metrics.",
  "about.p2": "Our objective is simple and measurable: improve the economics of acquisition. That means protecting contribution margin, shortening payback where we can, and telling you early when spend should pause — not only when it should rise.",
  "about.p3": "Transparency is non-negotiable. Shared dashboards, weekly written notes, and open access to what we tested, what failed, and what we will try next. You stay in control of the strategy; we own the execution speed.",
  "about.li.0": "Objective: profitable customer acquisition — not just more spend.",
  "about.li.1": "Transparency: shared numbers, weekly notes, and honest kill decisions.",
  "about.li.2": "Focus: US DTC brands scaling on Meta and TikTok with clean tracking.",
  "value.0.title": "Radical transparency",
  "value.0.body": "You see the same numbers we do: spend, CAC, ROAS, and contribution margin — explained in plain English every week.",
  "value.1.title": "Clear objectives",
  "value.1.body": "We set targets before we scale: payback window, margin floor, and creative volume. No vague “brand awareness” escapes.",
  "value.2.title": "Operator accountability",
  "value.2.body": "The team that plans the week also ships the changes. You always know who owns the next test.",
  "value.3.title": "Registered US company",
  "value.3.body": "{legal} · professional billing and contracts.",
  "process.eyebrow": "Process",
  "process.title": "Diagnose → install → pressure-test → compound",
  "step.0.n": "01",
  "step.0.title": "Diagnose",
  "step.0.body": "Tracking, creative library, and unit economics — we map what actually blocks profitable scale.",
  "step.1.n": "02",
  "step.1.title": "Install",
  "step.1.body": "Clean structure, first angle batch, and guardrails so spend has a job from day one.",
  "step.2.n": "03",
  "step.2.title": "Pressure-test",
  "step.2.body": "Small controlled bets across hooks and audiences until winners prove they hold.",
  "step.3.n": "04",
  "step.3.title": "Compound",
  "step.3.body": "Scale winners, kill losers weekly, and report against margin — not vanity ROAS alone.",
  "blog.eyebrow": "Blog",
  "blog.title": "Latest from the growth floor",
  "blog.byline": "growth notes",
  "post.0.title": "Maximizing ROAS without killing contribution margin",
  "post.0.body": "Guessing is expensive. Here’s how DTC brands should read ROAS, CAC, and margin together before they scale another dollar.",
  "post.1.title": "Brand storytelling that converts — without the fluff",
  "post.1.body": "Shoppers don’t buy logos. They buy trust. Here’s how narrative, proof, and paid creative work together for DTC brands.",
  "post.2.title": "The playbook: Meta & TikTok as a power duo",
  "post.2.body": "One product isn’t enough anymore. Here’s how to run Meta and TikTok as one acquisition system — with roles, budgets, and creative that compound.",
  "contact.eyebrow": "Get in touch",
  "contact.title": "Ready to grow your brand?",
  "contact.intro": "Let’s review your Meta & TikTok setup and show where growth is blocked — then how to unlock it.",
  "contact.phoneLabel": "Phone",
  "contact.emailLabel": "Email",
  "contact.addressLabel": "Address",
  "contact.formTitle": "Ready to grow your business?",
  "contact.formIntro": "Fill out the form and we’ll get back within 24 hours. Prefer email?",
  "contact.submit": "Send message",
};

export function BankPageView({ page, editable = false, onEdit }: { page: BankPage | BankPageDraft; editable?: boolean; onEdit?: (path: string, value: string) => void }) {
  const theme = themeOf(page.themeId);
  const vars = {
    "--blue": theme.blue,
    "--blue-deep": theme.deep,
    "--blue-wash": theme.wash,
    "--ink": "#0a1620",
    "--ink-soft": "#5a6b78",
    "--line": "#e2eef3",
    "--surface": "#f7fbfd",
  } as React.CSSProperties;

  /* Un texte libre, avec la marque et la raison sociale injectées dans les défauts. */
  const tx = (key: string) => {
    const custom = page.texts?.[key];
    if (custom !== undefined) return custom;
    return (BANK_DEFAULT_TEXTS[key] ?? "").replace(/\{brand\}/g, page.brandName).replace(/\{legal\}/g, page.legalName);
  };
  const tp = (key: string) => `texts.${key}`;

  return (
    <Edit.Provider value={{ editable, onEdit }}>
      <div
        className={cn("bank-site min-h-screen bg-white text-[15px] antialiased", editable && "bank-editing")}
        style={vars}
        onClickCapture={(event) => {
          /* En édition, les liens ne naviguent pas : on clique pour corriger. */
          if (editable && (event.target as HTMLElement).closest("a")) event.preventDefault();
        }}
      >
        <style>{`
        .bank-site { color: var(--ink); font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif; }
        .bank-site .wrap { margin: 0 auto; max-width: 1120px; padding: 0 20px; }
        .bank-site .btn {
          display:inline-flex; align-items:center; justify-content:center;
          border-radius:10px; background:var(--blue); color:#fff; font-weight:600;
          padding:11px 18px; letter-spacing:-0.01em;
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--blue) 55%, white),
            0 14px 34px -14px color-mix(in srgb, var(--blue) 80%, transparent),
            0 0 28px -8px color-mix(in srgb, var(--blue) 55%, transparent);
        }
        .bank-site .btn:hover { filter: brightness(1.04); }
        .bank-site a { color: inherit; text-decoration: none; }
        .bank-site input, .bank-site select, .bank-site textarea {
          width:100%; border-radius:10px; border:1px solid #d7e6ec; background:#fff;
          padding:10px 12px; font: inherit; color: var(--ink);
        }
        .bank-editing .bank-edit { cursor: text; border-radius: 4px; outline: 1px dashed transparent; outline-offset: 2px; transition: outline-color .12s, background-color .12s; }
        .bank-editing .bank-edit:hover { outline-color: color-mix(in srgb, var(--blue) 70%, transparent); background: color-mix(in srgb, var(--blue) 9%, transparent); }
        .bank-editing .bank-edit:focus { outline: 2px solid var(--blue); background: #fff; color: var(--ink); box-shadow: 0 0 0 4px color-mix(in srgb, var(--blue) 18%, transparent); }
        .bank-editing .btn.bank-edit:focus { color: #fff; background: var(--blue); }
        .bank-editing [contenteditable]:empty::before { content: "…"; opacity: .4; }
      `}</style>

        <header className="sticky top-0 z-40 border-b border-[color:var(--line)]/70 bg-white/80 backdrop-blur-sm">
          <div className="wrap flex h-14 items-center justify-between md:h-16">
            {page.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={page.logoDataUrl} alt={page.brandName} className="h-[19px] max-w-[152px] object-contain object-left" />
            ) : (
              <T path="brandName" value={page.brandName} className="text-[15px] font-semibold tracking-tight" />
            )}
            <nav className="hidden items-center gap-0.5 text-[13px] font-semibold text-[color:var(--ink)]/70 lg:flex">
              {["Home", "Services", "Results", "About", "Contact"].map((item) => (
                <a key={item} href={`#${item.toLowerCase()}`} className="rounded-md px-3 py-2 hover:bg-[color:var(--blue-wash)]">
                  {item}
                </a>
              ))}
            </nav>
            <a href="#contact" className="btn hidden text-[13px] lg:inline-flex">
              <T path={tp("cta")} value={tx("cta")} />
            </a>
          </div>
        </header>

        <section id="home" className="wrap grid gap-10 py-14 md:grid-cols-[1.12fr_0.88fr] md:py-[72px]">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]">
              <T path="brandName" value={page.brandName} /> · <T path="tagline" value={page.tagline} />
            </p>
            <T path="heroTitle" value={page.heroTitle} as="h1" className="mt-3 text-[34px] font-semibold leading-[1.12] tracking-[-0.035em] md:text-[48px]" />
            <T path="heroSubtitle" value={page.heroSubtitle} as="p" multiline className="mt-4 max-w-xl text-[16px] leading-relaxed text-[color:var(--ink-soft)]" />
            <a href="#contact" className="btn mt-7">
              <T path={tp("cta")} value={tx("cta")} />
            </a>
            <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {page.stats.map((stat, index) => (
                <div key={index}>
                  <T path={`stats.${index}.value`} value={stat.value} as="p" className="text-[22px] font-semibold tracking-tight" />
                  <T path={`stats.${index}.label`} value={stat.label} as="p" className="text-[12px] text-[color:var(--ink-soft)]" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3">
            {[0, 1, 2].map((index) => (
              <article key={index} className="rounded-2xl bg-[color:var(--blue-wash)] p-5 ring-1 ring-[color:var(--line)]">
                <T path={tp(`pillar.${index}.tag`)} value={tx(`pillar.${index}.tag`)} as="p" className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--blue-deep)]" />
                <T path={tp(`pillar.${index}.title`)} value={tx(`pillar.${index}.title`)} as="h3" className="mt-1 text-[16px] font-semibold" />
                <T path={tp(`pillar.${index}.body`)} value={tx(`pillar.${index}.body`)} as="p" multiline className="mt-1 text-sm leading-relaxed text-[color:var(--ink-soft)]" />
              </article>
            ))}
          </div>
        </section>

        <section id="services" className="border-t border-[color:var(--line)] bg-[color:var(--surface)] py-14">
          <div className="wrap">
            <T path={tp("services.eyebrow")} value={tx("services.eyebrow")} as="p" className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]" />
            <T path={tp("services.title")} value={tx("services.title")} as="h2" className="mt-2 text-[28px] font-semibold tracking-tight" />
            <T path={tp("services.intro")} value={tx("services.intro")} as="p" multiline className="mt-2 max-w-2xl text-sm text-[color:var(--ink-soft)]" />
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {page.services.map((service, index) => (
                <article key={index} className="rounded-2xl bg-white p-5 ring-1 ring-[color:var(--line)]">
                  <T path={`services.${index}.title`} value={service.title} as="h3" className="text-[16px] font-semibold" />
                  <T path={`services.${index}.body`} value={service.body} as="p" multiline className="mt-2 text-sm leading-relaxed text-[color:var(--ink-soft)]" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="results" className="wrap py-14">
          <T path={tp("results.eyebrow")} value={tx("results.eyebrow")} as="p" className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]" />
          <T path={tp("results.title")} value={tx("results.title")} as="h2" className="mt-2 text-[28px] font-semibold tracking-tight" />
          <T path={tp("results.intro")} value={tx("results.intro")} as="p" multiline className="mt-2 max-w-2xl text-sm text-[color:var(--ink-soft)]" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {page.results.map((result, index) => (
              <article key={index} className="rounded-2xl bg-[color:var(--surface)] p-5 ring-1 ring-[color:var(--line)]">
                <T path={`results.${index}.brand`} value={result.brand} as="p" className="text-[12px] font-medium text-[color:var(--ink-soft)]" />
                <T path={`results.${index}.metric`} value={result.metric} as="p" className="mt-2 text-[28px] font-semibold tracking-tight" />
                <T path={`results.${index}.detail`} value={result.detail} as="p" className="text-sm font-medium" />
                <T path={`results.${index}.note`} value={result.note} as="p" className="mt-1 text-[12px] text-[color:var(--ink-soft)]" />
              </article>
            ))}
          </div>
        </section>

        <section id="about" className="border-t border-[color:var(--line)] bg-[color:var(--surface)] py-14">
          <div className="wrap grid gap-10 md:grid-cols-2">
            <div>
              <T path={tp("about.eyebrow")} value={tx("about.eyebrow")} as="p" className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]" />
              <T path={tp("about.title")} value={tx("about.title")} as="h2" className="mt-2 text-[28px] font-semibold tracking-tight" />
              <T path={tp("about.p1")} value={tx("about.p1")} as="p" multiline className="mt-4 text-sm leading-relaxed text-[color:var(--ink-soft)]" />
              <T path={tp("about.p2")} value={tx("about.p2")} as="p" multiline className="mt-3 text-sm leading-relaxed text-[color:var(--ink-soft)]" />
              <T path={tp("about.p3")} value={tx("about.p3")} as="p" multiline className="mt-3 text-sm leading-relaxed text-[color:var(--ink-soft)]" />
              <ul className="mt-5 space-y-2 text-sm text-[color:var(--ink-soft)]">
                {[0, 1, 2].map((index) => (
                  <T key={index} path={tp(`about.li.${index}`)} value={tx(`about.li.${index}`)} as="li" />
                ))}
              </ul>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((index) => (
                <article key={index} className="rounded-2xl bg-white p-4 ring-1 ring-[color:var(--line)]">
                  <T path={tp(`value.${index}.title`)} value={tx(`value.${index}.title`)} as="h3" className="text-sm font-semibold" />
                  <T path={tp(`value.${index}.body`)} value={tx(`value.${index}.body`)} as="p" multiline className="mt-1 text-[13px] leading-relaxed text-[color:var(--ink-soft)]" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="wrap py-14">
          <T path={tp("process.eyebrow")} value={tx("process.eyebrow")} as="p" className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]" />
          <T path={tp("process.title")} value={tx("process.title")} as="h2" className="mt-2 text-[28px] font-semibold tracking-tight" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <article key={index} className="rounded-2xl p-5 ring-1 ring-[color:var(--line)]">
                <T path={tp(`step.${index}.n`)} value={tx(`step.${index}.n`)} as="p" className="text-[12px] font-semibold text-[color:var(--blue)]" />
                <T path={tp(`step.${index}.title`)} value={tx(`step.${index}.title`)} as="h3" className="mt-2 font-semibold" />
                <T path={tp(`step.${index}.body`)} value={tx(`step.${index}.body`)} as="p" multiline className="mt-1 text-sm text-[color:var(--ink-soft)]" />
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-[color:var(--line)] bg-[color:var(--surface)] py-14">
          <div className="wrap">
            <T path={tp("blog.eyebrow")} value={tx("blog.eyebrow")} as="p" className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]" />
            <T path={tp("blog.title")} value={tx("blog.title")} as="h2" className="mt-2 text-[28px] font-semibold tracking-tight" />
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <article key={index} className="rounded-2xl bg-white p-5 ring-1 ring-[color:var(--line)]">
                  <T path={tp(`post.${index}.title`)} value={tx(`post.${index}.title`)} as="h3" className="text-[15px] font-semibold leading-snug" />
                  <p className="mt-2 text-[12px] text-[color:var(--ink-soft)]">
                    <T path="brandName" value={page.brandName} /> · <T path={tp("blog.byline")} value={tx("blog.byline")} />
                  </p>
                  <T path={tp(`post.${index}.body`)} value={tx(`post.${index}.body`)} as="p" multiline className="mt-2 text-sm leading-relaxed text-[color:var(--ink-soft)]" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="border-t border-[color:var(--line)] bg-[color:var(--ink)] py-14 text-white">
          <div className="wrap grid gap-10 md:grid-cols-2">
            <div>
              <T path={tp("contact.eyebrow")} value={tx("contact.eyebrow")} as="p" className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/50" />
              <T path={tp("contact.title")} value={tx("contact.title")} as="h2" className="mt-2 text-[28px] font-semibold tracking-tight" />
              <T path={tp("contact.intro")} value={tx("contact.intro")} as="p" multiline className="mt-3 text-sm text-white/70" />
              <p className="mt-6 text-sm text-white/80">
                <T path={tp("contact.phoneLabel")} value={tx("contact.phoneLabel")} className="block text-[11px] uppercase tracking-wide text-white/45" />
                <T path="phone" value={page.phone} />
                <T path={tp("contact.emailLabel")} value={tx("contact.emailLabel")} className="mt-3 block text-[11px] uppercase tracking-wide text-white/45" />
                <T path="email" value={page.email} />
                <T path={tp("contact.addressLabel")} value={tx("contact.addressLabel")} className="mt-3 block text-[11px] uppercase tracking-wide text-white/45" />
                <T path="addressLine" value={page.addressLine} />
                <br />
                <T path="city" value={page.city} />, <T path="region" value={page.region} /> <T path="postalCode" value={page.postalCode} />
                <br />
                <T path="country" value={page.country} />
              </p>
            </div>
            <form className="grid gap-3" action={`mailto:${page.email}`} method="post" encType="text/plain">
              <T path={tp("contact.formTitle")} value={tx("contact.formTitle")} as="p" className="text-[18px] font-semibold" />
              <p className="text-[13px] text-white/60">
                <T path={tp("contact.formIntro")} value={tx("contact.formIntro")} /> <T path="email" value={page.email} />
              </p>
              <input name="name" placeholder="Full name" readOnly={editable} />
              <input name="email" placeholder="Email" type="email" readOnly={editable} />
              <input name="site" placeholder="Website / store URL" readOnly={editable} />
              <select name="spend" defaultValue="" disabled={editable}>
                <option value="" disabled>
                  Monthly ad spend
                </option>
                <option>Under $5k / month</option>
                <option>$5k – $15k / month</option>
                <option>$15k – $50k / month</option>
                <option>$50k – $100k / month</option>
                <option>$100k+ / month</option>
              </select>
              <textarea className="min-h-24" name="message" placeholder="Message" readOnly={editable} />
              <button className="btn mt-1 w-fit" type={editable ? "button" : "submit"}>
                <T path={tp("contact.submit")} value={tx("contact.submit")} />
              </button>
            </form>
          </div>
        </section>

        <footer className="bg-[color:var(--ink)] pb-8 text-center text-[11px] text-white/40">
          <T path="legalName" value={page.legalName} /> · <T path="country" value={page.country} />
        </footer>
      </div>
    </Edit.Provider>
  );
}
