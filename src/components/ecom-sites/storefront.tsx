import type { CSSProperties, ReactNode } from "react";
import { ApplyTextEdits } from "@/components/ecom-sites/apply-text-edits";
import { AddToCartButton, CartLink, CartProvider } from "@/components/ecom-sites/cart";
import { ContactForm } from "@/components/ecom-sites/contact-form";
import { type PolicyDoc } from "@/lib/ecom-sites/policies";
import {
  defaultCopyright,
  footerCols,
  footerColumns,
  footerHref,
  footerPayments,
} from "@/lib/ecom-sites/footer";
import { navItems } from "@/lib/ecom-sites/pages";
import { fullAddress, money, sitePalette, type EcomPage, type EcomProduct, type EcomSite } from "@/lib/ecom-sites/types";
import { alignClass, assuranceItems, sectionStyle, sectionsOf, spaceClass } from "@/lib/ecom-sites/sections";
import type { EcomSection } from "@/lib/ecom-sites/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Coquille : barre promo, header, footer.
 * Le footer porte tout ce que l'underwriting recoupe — raison sociale,
 * adresse, e-mail, téléphone, horaires, descripteur de facturation.
 * ------------------------------------------------------------------ */

function base(site: EcomSite) {
  return `/s/${site.slug}`;
}

export function Storefront({ site, children }: { site: EcomSite; children: ReactNode }) {
  // Les deux couleurs de marque priment sur le thème quand elles sont posées.
  const theme = sitePalette(site.themeId, site.brandColors);
  const root = base(site);
  // Les pages fixes, puis les pages ajoutées qu'on veut dans le menu.
  const NAV = navItems(site);
  const vars = {
    "--ink": theme.ink,
    "--accent": theme.accent,
    "--deep": theme.deep,
    "--wash": theme.wash,
    "--sand": theme.sand,
    "--line": "#e6e1dd",
    "--muted": "#6d6560",
  } as CSSProperties;

  return (
    <CartProvider slug={site.slug}>
    <div className="shopfront min-h-screen bg-white text-[15px] antialiased" style={vars}>
      {/* Les mots du gabarit corrigés depuis l'aperçu, appliqués à la page rendue. */}
      <ApplyTextEdits edits={site.textEdits} />
      <style>{`
        .shopfront { color: var(--ink); font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif; }
        /*
         * Rien ne dépasse, jamais.
         *
         * Un bandeau promo en « nowrap », une image trop large ou un nom de
         * produit sans espace suffisent à créer un débordement horizontal — et
         * sur mobile ça se voit tout de suite : la page glisse latéralement et
         * le centrage part. On coupe le mal à la racine plutôt que de corriger
         * bloc par bloc.
         */
        .shopfront { overflow-x: hidden; }
        .shopfront * { min-width: 0; }
        /*
         * Une largeur maximale seulement, jamais de hauteur.
         *
         * Poser height:auto ici l'emportait sur les hauteurs données en classe,
         * sa spécificité étant plus forte : le logo du header, censé faire
         * 28 px, s'affichait à sa taille naturelle. Il écrasait la navigation
         * et faisait déborder la page.
         */
        .shopfront img, .shopfront video { max-width: 100%; }

        /*
         * Gouttière qui s'adapte : 20 px fixes collaient au bord sur un petit
         * écran. La marge s'ouvre avec la place disponible, et le contenu reste
         * centré quelle que soit la largeur.
         */
        .shopfront .wrap {
          margin: 0 auto;
          width: 100%;
          max-width: 1180px;
          padding-inline: clamp(16px, 5vw, 32px);
        }
        .shopfront a { color: inherit; text-decoration: none; }
        .shopfront .btn {
          display:inline-flex; align-items:center; justify-content:center; gap:8px;
          border-radius:999px; background:var(--accent); color:#fff; font-weight:650;
          padding:12px 24px; letter-spacing:-0.01em; transition:filter .15s ease;
        }
        .shopfront .btn:hover { filter: brightness(1.06); }
        /*
         * La classe des boutons ne doit pas empêcher de les cacher.
         *
         * La règle qui leur donne display:inline-flex pèse plus lourd que la
         * classe utilitaire "hidden" : l'appel à l'action de l'en-tête, censé
         * disparaître sous 640 px, restait affiché et passait à la ligne dans
         * un en-tête déjà serré. Cette règle rend la main aux utilitaires.
         */
        .shopfront .btn.hidden, .shopfront .btn-ghost.hidden { display: none; }
        .shopfront .btn-ghost {
          display:inline-flex; align-items:center; justify-content:center;
          border-radius:999px; border:1px solid var(--ink); padding:11px 23px; font-weight:650;
        }
        .shopfront .eyebrow {
          font-size:11px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--accent);
        }
        .shopfront .card { border:1px solid var(--line); border-radius:18px; background:#fff; overflow:hidden; }
        /*
         * Les accordéons de la fiche produit, sans JavaScript : un <details>
         * natif, sa ligne de titre avec un chevron qui se retourne à l'ouverture.
         */
        .shopfront details.fold { border-top: 1px solid var(--line); }
        .shopfront details.fold:last-child { border-bottom: 1px solid var(--line); }
        .shopfront details.fold > summary {
          list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between;
          padding: 14px 0; font-weight: 700; font-size: 15px; color: var(--ink);
        }
        .shopfront details.fold > summary::-webkit-details-marker { display: none; }
        .shopfront details.fold > summary::after {
          content: ""; width: 8px; height: 8px; margin-right: 4px; flex: none;
          border-right: 2px solid var(--ink); border-bottom: 2px solid var(--ink);
          transform: rotate(45deg); transition: transform .18s ease;
        }
        .shopfront details.fold[open] > summary::after { transform: rotate(225deg); }
        /* Les champs du formulaire de contact, dans la ligne des cartes. */
        .shopfront [data-contact-form] input, .shopfront [data-contact-form] textarea {
          width:100%; border:1px solid var(--line); border-radius:12px; padding:11px 14px;
          font:inherit; font-weight:400; color:var(--ink); background:#fff;
        }
        .shopfront [data-contact-form] input:focus, .shopfront [data-contact-form] textarea:focus {
          outline:2px solid var(--accent); outline-offset:1px;
        }
        @keyframes shopfront-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .shopfront .marquee-track { display:flex; width:max-content; animation: shopfront-marquee 32s linear infinite; }

        /*
         * Les sections se révèlent à l'approche du regard.
         *
         * Tout est en CSS pur : ni librairie, ni JavaScript, ni observateur à
         * monter. Le navigateur anime au fil du défilement, et une page servie
         * sans JS reste entièrement lisible — les sections apparaissent
         * simplement d'un coup.
         */
        @keyframes shopfront-rise {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: none; }
        }
        .shopfront .reveal {
          animation: shopfront-rise .7s cubic-bezier(.21,.6,.35,1) both;
          animation-timeline: view();
          animation-range: entry 0% entry 42%;
        }
        /* Repli pour les navigateurs sans « animation-timeline » : la section
           s'anime une fois au chargement plutôt que de rester invisible. */
        @supports not (animation-timeline: view()) {
          .shopfront .reveal { animation: shopfront-rise .7s ease both; }
        }

        /*
         * Le menu du téléphone, sans une ligne de JavaScript.
         *
         * L'état vit dans une case à cocher masquée ; le panneau et l'icône
         * réagissent à son état coché, atteint par un sélecteur de frère.
         * Rien à hydrater, rien qui casse si le script ne charge pas.
         */
        .shopfront .menu-panel { display: none; }
        .shopfront #shopfront-menu:checked ~ .menu-panel { display: block; }
        .shopfront .menu-toggle:hover { background: var(--wash); }
        .shopfront .menu-bars,
        .shopfront .menu-bars::before,
        .shopfront .menu-bars::after {
          content: ""; display: block; width: 18px; height: 2px;
          background: var(--ink); border-radius: 2px;
          transition: transform .22s ease, opacity .22s ease;
        }
        .shopfront .menu-bars { position: relative; }
        .shopfront .menu-bars::before { position: absolute; top: -6px; }
        .shopfront .menu-bars::after  { position: absolute; top: 6px; }
        .shopfront #shopfront-menu:checked ~ div .menu-toggle .menu-bars { background: transparent; }
        .shopfront #shopfront-menu:checked ~ div .menu-toggle .menu-bars::before { transform: translateY(6px) rotate(45deg); }
        .shopfront #shopfront-menu:checked ~ div .menu-toggle .menu-bars::after  { transform: translateY(-6px) rotate(-45deg); }

        /*
         * Lisibilité sur téléphone.
         *
         * Les tailles de 10 et 11 px passent sur un écran de bureau à 60 cm ;
         * dans la main, à bout de bras, elles se devinent plus qu'elles ne se
         * lisent. Le plancher passe à 12 px sous 640 px, et les gouttières se
         * resserrent pour que le contenu garde sa place.
         */
        @media (max-width: 640px) {
          .shopfront .eyebrow { font-size: 11px; letter-spacing: .12em; }
          .shopfront p, .shopfront li, .shopfront a, .shopfront span, .shopfront td { font-size: max(1em, 12px); }
          /* Un titre de fiche produit porte la contenance et le
             conditionnement : à 32 px il tenait sur quatre lignes et repoussait
             le prix hors de l'écran. */
          .shopfront h1 { font-size: 27px; line-height: 1.12; }
          .shopfront h2 { font-size: 23px; }
          .shopfront .btn, .shopfront .btn-ghost { padding: 12px 20px; }
          /* Une cible tactile ne descend pas sous 44 px de haut. */
          .shopfront .btn, .shopfront .btn-ghost, .shopfront button, .shopfront input, .shopfront select {
            min-height: 44px;
          }
        }

        .shopfront .clamp-2, .shopfront .clamp-3 {
          display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden;
        }
        .shopfront .clamp-2 { -webkit-line-clamp: 2; }
        .shopfront .clamp-3 { -webkit-line-clamp: 3; }

        /* La bannière respire lentement derrière le titre. */
        @keyframes shopfront-drift { from { transform: scale(1.06); } to { transform: scale(1); } }
        .shopfront .hero-media { animation: shopfront-drift 14s ease-out both; }

        /* Le survol : la carte se soulève, l'image se rapproche. */
        .shopfront .card { transition: transform .35s cubic-bezier(.21,.6,.35,1), box-shadow .35s ease, border-color .35s ease; }
        .shopfront .lift:hover {
          transform: translateY(-4px);
          box-shadow: 0 18px 40px -24px rgba(15, 23, 42, .38);
          border-color: color-mix(in srgb, var(--accent) 38%, var(--line));
        }
        .shopfront .btn, .shopfront .btn-ghost { transition: transform .18s ease, filter .18s ease, background-color .18s ease, color .18s ease; }
        .shopfront .btn:hover, .shopfront .btn-ghost:hover { transform: translateY(-1px); }
        .shopfront .btn:active, .shopfront .btn-ghost:active { transform: translateY(0); }
        .shopfront .btn-ghost:hover { background: var(--ink); color: #fff; }
        .shopfront nav a { transition: background-color .2s ease, color .2s ease; }

        /*
         * Rien ne bouge pour qui a demandé que rien ne bouge.
         *
         * Ce réglage système n'est pas une préférence esthétique : il sert aux
         * troubles vestibulaires, où une image qui glisse provoque un vrai
         * malaise. On coupe tout, y compris le bandeau promotionnel.
         */
        @media (prefers-reduced-motion: reduce) {
          .shopfront .marquee-track,
          .shopfront .reveal,
          .shopfront .hero-media { animation: none; }
          .shopfront *, .shopfront *::before, .shopfront *::after {
            transition-duration: .01ms !important;
          }
          .shopfront .lift:hover { transform: none; }
        }
      `}</style>

      {site.promoBar ? (
        <div className="overflow-hidden bg-[color:var(--ink)] py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
          <div className="marquee-track">
            {[0, 1].map((copy) => (
              <span key={copy} className="whitespace-nowrap px-6" aria-hidden={copy === 1}>
                {site.promoBar}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <header className="sticky top-0 z-40 border-b border-[color:var(--line)] bg-white/90 backdrop-blur">
        {/* La case porte l'état du menu, et doit rester sœur du panneau : c'est
            le seul lien qu'un sélecteur CSS sait remonter. */}
        <input type="checkbox" id="shopfront-menu" className="sr-only" aria-label="Menu" />
        <div className="wrap flex h-16 items-center justify-between gap-3 sm:gap-6">
          <a href={root} className="flex items-center gap-2">
            {site.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={site.logoDataUrl}
                alt={site.brandName}
                /* Le logo arrive détouré : il peut occuper toute sa hauteur
                   sans se retrouver noyé dans une marge transparente. */
                className="h-8 w-auto max-w-[150px] shrink-0 object-contain object-left sm:h-9 sm:max-w-[190px]"
              />
            ) : (
              <span className="text-[17px] font-bold tracking-tight">{site.brandName}</span>
            )}
          </a>
          <nav className="hidden min-w-0 items-center gap-0.5 text-[13px] font-semibold text-[color:var(--muted)] lg:flex">
            {NAV.map((item, index) => (
              <a key={`${item.path}-${index}`} href={footerHref(root, item.path)} className="rounded-full px-3 py-2 hover:bg-[color:var(--wash)] hover:text-[color:var(--ink)]">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <CartLink slug={site.slug} />
            <a href={`${root}/shop`} className="btn hidden text-[13px] sm:inline-flex">
              Shop now
            </a>
            {/* Le menu du téléphone.

                Sous 1024 px la navigation disparaissait sans rien pour la
                remplacer : depuis un téléphone, on ne pouvait plus atteindre
                Shipping, Returns ni Contact autrement qu'en descendant jusqu'au
                pied de page. Les politiques sont justement ce qu'un acheteur
                cherche avant de payer, et ce qu'un souscripteur vient vérifier. */}
            <label
              htmlFor="shopfront-menu"
              className="menu-toggle flex h-10 w-10 cursor-pointer items-center justify-center rounded-full lg:hidden"
              aria-hidden="true"
            >
              <span className="menu-bars" />
            </label>
          </div>
        </div>

        <nav className="menu-panel border-t border-[color:var(--line)] bg-white lg:hidden">
          <div className="wrap flex flex-col py-2">
            {NAV.map((item, index) => (
              <a
                key={`${item.path}-${index}`}
                href={footerHref(root, item.path)}
                className="border-b border-[color:var(--line)] py-3 text-[15px] font-semibold last:border-0"
              >
                {item.label}
              </a>
            ))}
            <a href={`${root}/shop`} className="btn mt-3 mb-2">Shop now</a>
          </div>
        </nav>
      </header>

      <main>{children}</main>

      <Footer site={site} />
    </div>
    </CartProvider>
  );
}

function Footer({ site }: { site: EcomSite }) {
  const root = base(site);
  const year = new Date().getFullYear();
  const columns = footerColumns(site);
  const payments = footerPayments(site);
  const legalLine = site.footer?.legalLine?.trim();

  return (
    <footer className="mt-20 border-t border-[color:var(--line)] bg-[color:var(--sand)]">
      <div className="wrap py-14">
        {/* Phrase d'identité : le premier endroit où un underwriter cherche la LLC.

            Elle ne s'affiche que renseignée. Avec des champs vides elle sortait
            « is owned and operated by , a  company headquartered at , United
            States » — une phrase à trous qui se remarque bien plus que son
            absence, et sur laquelle un souscripteur s'arrête. */}
        {legalLine ? (
          <p className="max-w-3xl text-[13px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">{legalLine}</p>
        ) : site.legalName?.trim() ? (
          <p className="max-w-3xl text-[13px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">
            <strong className="text-[color:var(--ink)]">{site.domain || site.brandName}</strong> is owned and operated by{" "}
            <strong className="text-[color:var(--ink)]">{site.legalName}</strong>
            {site.stateOfIncorporation ? `, a ${site.stateOfIncorporation} limited liability company` : ""}
            {fullAddress(site).trim() ? (
              <>
                {" "}headquartered at{" "}
                <strong className="text-[color:var(--ink)]">
                  {fullAddress(site)}
                  {site.country ? `, ${site.country}` : ""}
                </strong>
              </>
            ) : null}
            .
          </p>
        ) : null}

        <div className={cn("mt-10 grid gap-10 sm:grid-cols-2", footerCols(columns.length + (site.footer?.hideContact ? 0 : 1)))}>
          {/* Les colonnes de liens, telles qu'on les a réglées. */}
          {columns.map((column, index) => (
            <div key={`${column.title}-${index}`}>
              <h3 className="eyebrow">{column.title}</h3>
              {/* Une colonne de texte — le bloc « About » du bas de page. */}
              {column.body?.trim()
                ? column.body.split(/\n{2,}/).map((paragraph) => (
                    <p key={paragraph} className="mt-3 text-[13px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">
                      {paragraph}
                    </p>
                  ))
                : null}
              <ul className="mt-3 space-y-2 text-[13px] text-[color:var(--muted)]">
                {column.links.map((link, linkIndex) => (
                  <li key={`${link.label}-${linkIndex}`}>
                    <a href={footerHref(root, link.href)} className="hover:text-[color:var(--ink)]">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Bloc contact : nom, adresse, téléphone et e-mail, cliquables.

              Il reste déduit des champs support, et pas modifiable ici : c'est
              la première chose qu'un souscripteur recoupe avec le dossier, et
              une adresse retapée à la main dans le footer ne correspondrait
              plus à celle des politiques. On peut le retirer, pas le réécrire. */}
          {site.footer?.hideContact ? null : (
          <address className="not-italic">
            <h3 className="eyebrow">Contact</h3>
            <ul className="mt-3 space-y-2 text-[13px] text-[color:var(--muted)]">
              <li className="font-semibold text-[color:var(--ink)]">{site.legalName}</li>
              <li>
                Address: {fullAddress(site)}
                {site.country ? `, ${site.country}` : ""}
              </li>
              {site.supportPhone ? (
                <li>
                  Call:{" "}
                  <a href={`tel:${site.supportPhone.replace(/[^+\d]/g, "")}`} className="font-semibold text-[color:var(--ink)] hover:underline">
                    {site.supportPhone}
                  </a>
                </li>
              ) : null}
              {site.supportEmail ? (
                <li>
                  <a href={`mailto:${site.supportEmail}`} className="font-semibold text-[color:var(--ink)] hover:underline">
                    {site.supportEmail}
                  </a>
                </li>
              ) : null}
              {site.supportHours ? <li>Support open {site.supportHours}.</li> : null}
            </ul>
          </address>
          )}
        </div>

        {site.billingDescriptor ? (
          <p className="mt-10 rounded-xl border border-[color:var(--line)] bg-white px-4 py-3 text-[12px] text-[color:var(--muted)]">
            A charge will appear on your credit card statement with the billing descriptor{" "}
            <strong className="text-[color:var(--ink)]">&ldquo;{site.billingDescriptor}&rdquo;</strong>.
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 border-t border-[color:var(--line)] pt-6 text-[12px] text-[color:var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>{site.footer?.copyright?.trim() || defaultCopyright(site, year)}</p>
          {payments.length ? (
            <p className="flex flex-wrap items-center gap-2 font-semibold tracking-wide">
              {payments.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </p>
          ) : null}
        </div>

        {site.footer?.note?.trim() ? (
          <p className="mt-4 text-[12px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">{site.footer.note}</p>
        ) : null}

        {site.productDisclaimer ? (
          <p className="mt-4 text-[11px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">{site.productDisclaimer}</p>
        ) : null}
      </div>
    </footer>
  );
}


/**
 * Le cadre prend la forme de la photo, au lieu de l'inverse.
 *
 * Les packs sortent au format mesuré sur le site copié — souvent du 3:4. Dans
 * un cadre carré il fallait choisir : `cover` rognait le bouchon et l'étui,
 * `contain` laissait deux bandes vides et un rectangle visible au milieu de la
 * carte. En donnant au cadre le format de l'image, `cover` la fait remplir
 * exactement, sans rien couper.
 */
/**
 * La photo est-elle au format du catalogue ?
 *
 * On tolère 20 % d'écart : les packshots d'une même boutique varient un peu,
 * et les recadrer de quelques pour cent ne se voit pas. Au-delà, c'est autre
 * chose qu'un packshot, et le recadrage devient un zoom.
 */
function fitsFrame(site: EcomSite, product: EcomProduct) {
  const ratio = product.sourceImageRatio || 0;
  if (!ratio) return true;
  const [w, h] = (site.imageRatio || "1:1").split(":").map(Number);
  const target = w > 0 && h > 0 ? w / h : 1;
  return Math.abs(ratio - target) / target <= 0.2;
}

function frameRatio(site: EcomSite) {
  const [width, height] = (site.imageRatio || "1:1").split(":").map(Number);
  return width > 0 && height > 0 ? `${width} / ${height}` : "1 / 1";
}

/* ------------------------------------------------------------------ *
 * Carte produit
 * ------------------------------------------------------------------ */

export function ProductCard({ site, product }: { site: EcomSite; product: EcomProduct }) {
  return (
    <a href={`${base(site)}/product/${product.handle}`} className="card lift group flex flex-col">
      <div
        className="relative overflow-hidden bg-[color:var(--wash)]"
        style={{ aspectRatio: frameRatio(site) }}
      >
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            data-image-key={`product:${product.handle}`}
            className={cn(
              "h-full w-full transition-transform duration-500 group-hover:scale-[1.04]",
              // Une photo au format du catalogue remplit son cadre ; une
              // bannière égarée s'affiche entière plutôt que zoomée à l'excès.
              fitsFrame(site, product) ? "object-cover" : "object-contain p-4"
            )}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-[color:var(--muted)]">
            Packaging à générer
          </div>
        )}
        {product.badge ? (
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]">
            {product.badge}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
        {product.dosage ? (
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted)]">
            {product.dosage}
          </span>
        ) : null}
        {/* Trois lignes au plus : les noms de ces catalogues portent la
            contenance et le conditionnement, et débordaient sur le sous-titre
            dans une carte de demi-écran. */}
        <h3 className="clamp-3 text-[14px] font-bold leading-snug sm:text-[15px]">{product.name}</h3>
        {product.subtitle ? (
          <p className="clamp-2 text-[13px] text-[color:var(--muted)]">{product.subtitle}</p>
        ) : null}
        <p className="mt-auto pt-2 text-[15px] font-bold">
          {money(product.price, site.currency)}
          {product.compareAtPrice ? (
            <span className="ml-2 text-[13px] font-medium text-[color:var(--muted)] line-through">
              {money(product.compareAtPrice, site.currency)}
            </span>
          ) : null}
        </p>
      </div>
    </a>
  );
}

/* ------------------------------------------------------------------ *
 * Accueil
 * ------------------------------------------------------------------ */

export function HomeView({ site }: { site: EcomSite }) {
  const root = base(site);
  const featured = site.products.slice(0, 4);

  /*
   * La page se rend section par section.
   *
   * L'ordre venait du site copié et ne bougeait plus. Chaque section porte
   * maintenant son titre, son cadrage et son espacement, peut être masquée, et
   * deux blocs libres — texte et image — permettent de combler ce que le
   * modèle n'avait pas.
   */
  const sections = sectionsOf(site).filter((section) => !section.hidden);

  const render = (section: EcomSection) => {
    /* La clé se passe à part : dans un spread, React ne la lit pas. */
    const shell = { section };
    if (section.block === "pillars") return <PillarsBlock key={section.id} {...shell} site={site} />;
    if (section.block === "categories") return <CategoriesBlock key={section.id} {...shell} site={site} root={root} />;
    if (section.block === "lifestyle") return <LifestyleBlock key={section.id} {...shell} site={site} />;
    if (section.block === "products")
      return <FeaturedBlock key={section.id} {...shell} site={site} root={root} featured={featured} />;
    if (section.block === "about") return <AboutBlock key={section.id} {...shell} site={site} root={root} />;
    if (section.block === "reviews") return <ReviewsBlock key={section.id} {...shell} site={site} />;
    if (section.block === "assurances") return <AssurancesBlock key={section.id} {...shell} site={site} />;
    if (section.block === "text") return <FreeTextBlock key={section.id} {...shell} />;
    if (section.block === "image") return <FreeImageBlock key={section.id} {...shell} />;
    return null;
  };

  return (
    <>
      {/* La bannière générée était enregistrée puis jamais montrée : l'accueil
          affichait un packshot à sa place, ce qui donne un air de catalogue là
          où un site de marque ouvre sur une scène. Quand elle existe, elle prend
          toute la largeur et le texte passe dessus — c'est exactement le cadrage
          demandé au moment de la générer, avec le vide réservé pour le titre. */}
      {site.heroImageUrl ? (
        <section className="relative isolate overflow-hidden bg-[color:var(--wash)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={site.heroImageUrl}
            alt=""
            data-image-key="hero"
            className="hero-media absolute inset-0 -z-10 h-full w-full object-cover"
          />
          {/* Le voile garantit la lisibilité quelle que soit l'image sortie. */}
          <div
            className="absolute inset-0 -z-10"
            style={{
              background:
                "linear-gradient(100deg, rgba(255,255,255,.96) 0%, rgba(255,255,255,.88) 38%, rgba(255,255,255,.35) 62%, rgba(255,255,255,0) 82%)",
            }}
          />
          <div className="wrap py-20 md:py-32">
            <div className="max-w-[min(560px,100%)]">
              {site.tagline ? <p className="eyebrow">{site.tagline}</p> : null}
              <h1 className="mt-3 text-[38px] font-extrabold leading-[1.05] tracking-tight md:text-[52px]">
                {site.heroTitle || site.brandName}
              </h1>
              {site.heroSubtitle ? (
                <p className="mt-5 text-[15px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">{site.heroSubtitle}</p>
              ) : null}
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={`${root}/shop`} className="btn">Shop the line</a>
                <a href={`${root}/about`} className="btn-ghost">Learn more</a>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-[color:var(--wash)]">
          <div className="wrap grid grid-cols-1 items-center gap-10 py-14 md:grid-cols-2 md:py-24">
            <div>
              {site.tagline ? <p className="eyebrow">{site.tagline}</p> : null}
              <h1 className="mt-3 text-[38px] font-extrabold leading-[1.05] tracking-tight md:text-[52px]">
                {site.heroTitle || site.brandName}
              </h1>
              {site.heroSubtitle ? (
                <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">{site.heroSubtitle}</p>
              ) : null}
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={`${root}/shop`} className="btn">Shop the line</a>
                <a href={`${root}/about`} className="btn-ghost">Learn more</a>
              </div>
            </div>
            {/* Le repli du hero ne suppose aucun format.

                Les cartes produit peuvent remplir leur cadre : leurs photos
                sont au format mesuré sur le modèle. Ici, une seule image est
                choisie, et un catalogue contient parfois une bannière — un
                abonnement, une carte cadeau — dont le rapport n'a rien à voir.
                Recadrée, elle donnait un zoom illisible en haut de la page. */}
            {featured[0]?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={featured[0].imageUrl}
                alt={featured[0].name}
                className="w-full rounded-3xl bg-white/50 object-contain p-4"
                style={{ aspectRatio: frameRatio(site) }}
              />
            ) : (
              <div className="aspect-square rounded-3xl bg-white/60" />
            )}
          </div>
        </section>
      )}

      {sections.map(render)}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Boutique, fiche produit, politiques, contact, à propos
 * ------------------------------------------------------------------ */

export function ShopView({ site, category }: { site: EcomSite; category?: string }) {
  const root = base(site);
  const shown = category ? site.products.filter((product) => product.category === category) : site.products;

  return (
    <section className="wrap py-14">
      <p className="eyebrow">Shop</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight">All products</h1>

      {site.categories.length ? (
        <div className="mt-6 flex flex-wrap gap-2">
          <a
            href={`${root}/shop`}
            className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${!category ? "border-[color:var(--ink)] bg-[color:var(--ink)] text-white" : "border-[color:var(--line)]"}`}
          >
            All
          </a>
          {site.categories.map((item) => (
            <a
              key={item.id}
              href={`${root}/shop?cat=${item.id}`}
              className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${category === item.id ? "border-[color:var(--ink)] bg-[color:var(--ink)] text-white" : "border-[color:var(--line)]"}`}
            >
              {item.label}
            </a>
          ))}
        </div>
      ) : null}

      {/* Deux colonnes dès le téléphone : une carte par écran obligeait à faire
          défiler dix fois pour voir un catalogue de dix produits. */}
      {shown.length ? (
        <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {shown.map((product) => (
            <ProductCard key={product.handle} site={site} product={product} />
          ))}
        </div>
      ) : (
        <p className="mt-10 text-[14px] text-[color:var(--muted)]">No products in this category yet.</p>
      )}
    </section>
  );
}

export function ProductView({ site, product }: { site: EcomSite; product: EcomProduct }) {
  return (
    <section className="wrap grid gap-6 py-8 md:grid-cols-2 md:gap-12 md:py-14">
      {/* Sur un téléphone, la photo laisse la place au titre et au prix.

          À pleine largeur en 3:4 elle occupait tout l'écran : il fallait faire
          défiler pour découvrir ce que coûte le produit. On la borne par la
          LARGEUR et non par la hauteur — borner la hauteur gardait le cadre
          large, et le pack se faisait recadrer sur les côtés. */}
      <div
        className="card mx-auto w-full max-w-[62vw] bg-[color:var(--wash)] sm:max-w-[46vw] md:max-w-none"
        style={{ aspectRatio: frameRatio(site) }}
      >
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            data-image-key={`product:${product.handle}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-[color:var(--muted)]">
            Packaging à générer
          </div>
        )}
      </div>

      <div>
        {product.dosage ? <p className="eyebrow">{product.dosage}</p> : null}
        <h1 className="mt-2 text-[30px] font-extrabold leading-tight tracking-tight">{product.name}</h1>
        {product.subtitle ? <p className="mt-2 text-[15px] text-[color:var(--muted)]">{product.subtitle}</p> : null}

        <p className="mt-5 text-[24px] font-extrabold">
          {money(product.price, site.currency)}
          {product.compareAtPrice ? (
            <span className="ml-3 text-[16px] font-medium text-[color:var(--muted)] line-through">
              {money(product.compareAtPrice, site.currency)}
            </span>
          ) : null}
        </p>

        {/* Acheter vient juste après le prix.

            Le bouton était placé après la description et les arguments : sur un
            téléphone, avec les descriptions complètes reprises du site copié,
            il tombait à plus de 1 100 px du haut. On lit le prix, on peut
            acheter ; le détail reste dessous pour qui veut le lire. */}
        <AddToCartButton product={product} />

        {/* La description en accordéon, avec sa mise en page d'origine :
            paragraphes, intertitres, tableau d'ingrédients. Ouvert d'emblée. */}
        {product.descriptionBlocks?.length ? (
          <details open className="fold mt-6">
            <summary>Description</summary>
            <div className="space-y-4 pb-2 pt-1">
              <BlocksView site={site} blocks={product.descriptionBlocks} compact />
            </div>
          </details>
        ) : product.description ? (
          <details open className="fold mt-6">
            <summary>Description</summary>
            <p className="pb-2 pt-1 text-[14px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">{product.description}</p>
          </details>
        ) : null}

        {product.bullets.length ? (
          <ul className="mt-5 space-y-2 text-[14px]">
            {product.bullets.map((bullet) => (
              <li key={bullet} className="flex gap-2">
                <span className="text-[color:var(--accent)]">✦</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Le reste en accordéons repliés : on ouvre ce qu'on veut lire. */}
        <div className="mt-4 text-[13px]">
          {product.usage ? (
            <details className="fold">
              <summary>How to use</summary>
              <p className="pb-3 pt-1 text-[color:var(--muted)] whitespace-pre-line">{product.usage}</p>
            </details>
          ) : null}
          {product.ingredients ? (
            <details className="fold">
              <summary>Ingredients</summary>
              <p className="pb-3 pt-1 text-[color:var(--muted)] whitespace-pre-line">{product.ingredients}</p>
            </details>
          ) : null}
          <details className="fold">
            <summary>Shipping &amp; returns</summary>
            <p className="pb-3 pt-1 text-[color:var(--muted)]">
              Ships from {site.shipsFrom}. Delivery {site.deliveryMinDays}–{site.deliveryMaxDays} business days.{" "}
              {site.returnWindowDays}-day returns.
            </p>
          </details>
        </div>
      </div>
    </section>
  );
}

export function PolicyView({ site, doc }: { site: EcomSite; doc: PolicyDoc }) {
  return (
    <section className="wrap max-w-3xl py-14">
      <p className="eyebrow">Legal</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight">{doc.title}</h1>
      <p className="mt-2 text-[13px] text-[color:var(--muted)]">Last updated {doc.updated}</p>

      <div className="mt-10 space-y-9">
        {doc.sections.map((section) => (
          <div key={section.heading || section.body[0]}>
            {section.heading ? <h2 className="text-[17px] font-bold">{section.heading}</h2> : null}
            {section.body.map((paragraph, index) => (
              <p key={index} className="mt-3 text-[14px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">
                {paragraph}
              </p>
            ))}
          </div>
        ))}
      </div>

      <p className="mt-12 border-t border-[color:var(--line)] pt-6 text-[13px] text-[color:var(--muted)]">
        Questions about this policy? Email{" "}
        <a href={`mailto:${site.supportEmail}`} className="font-semibold text-[color:var(--ink)] underline">
          {site.supportEmail}
        </a>{" "}
        or call{" "}
        <a href={`tel:${site.supportPhone.replace(/[^+\d]/g, "")}`} className="font-semibold text-[color:var(--ink)] underline">
          {site.supportPhone}
        </a>
        .
      </p>
    </section>
  );
}

/**
 * Une page ajoutée — reprise d'un autre site ou écrite ici — rendue avec notre
 * header et notre footer. Chaque bloc est du texte ordinaire : il se corrige
 * dans l'aperçu, et un bloc vidé disparaît.
 */
export function CustomPageView({ site, page }: { site: EcomSite; page: EcomPage }) {
  return (
    <section className="wrap max-w-3xl py-14">
      <h1 className="text-[32px] font-extrabold tracking-tight">{page.title}</h1>
      <div className="mt-8 space-y-5">
        <BlocksView site={site} blocks={page.blocks} />
      </div>
    </section>
  );
}

/** Des blocs de contenu — page ajoutée ou description produit — rendus dans la charte de la boutique. */
export function BlocksView({ site, blocks, compact = false }: { site: EcomSite; blocks: EcomPage["blocks"]; compact?: boolean }) {
  const text = compact ? "text-[14px]" : "text-[15px]";
  return (
    <>
        {blocks.map((block, index) => {
          if (block.type === "form") return <ContactForm key={index} slug={site.slug} email={site.supportEmail} />;
          if (block.type === "heading") {
            if (!block.text.trim()) return null;
            return block.level === 2 ? (
              <h2 key={index} className={cn("font-bold tracking-tight", compact ? "pt-2 text-[16px]" : "pt-4 text-[21px]")}>
                {block.text}
              </h2>
            ) : (
              <h3 key={index} className={cn("font-bold", compact ? "pt-1 text-[14px]" : "pt-2 text-[17px]")}>
                {block.text}
              </h3>
            );
          }
          if (block.type === "paragraph") {
            if (!block.text.trim()) return null;
            return (
              <p key={index} className={cn(text, "leading-relaxed text-[color:var(--muted)] whitespace-pre-line")}>
                {block.text}
              </p>
            );
          }
          if (block.type === "list") {
            const items = block.items.filter((item) => item.trim());
            if (!items.length) return null;
            return (
              <ul key={index} className={cn(text, "list-disc space-y-1.5 pl-5 leading-relaxed text-[color:var(--muted)]")}>
                {items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            );
          }
          if (block.type === "table") {
            const rows = block.rows.filter((row) => row.some((cell) => cell.trim()));
            if (!rows.length) return null;
            const width = Math.max(block.header.length, ...rows.map((row) => row.length));
            return (
              <div key={index} className="overflow-x-auto rounded-2xl border border-[color:var(--line)]">
                <table className={cn("w-full border-collapse text-left", compact ? "text-[13px]" : "text-[14px]")}>
                  {block.header.some((cell) => cell.trim()) ? (
                    <thead className="bg-[color:var(--sand)] text-[12px] uppercase tracking-wide text-[color:var(--muted)]">
                      <tr>
                        {Array.from({ length: width }, (_, cellIndex) => (
                          <th key={cellIndex} className="px-4 py-3 font-semibold">
                            {block.header[cellIndex] ?? ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t border-[color:var(--line)] align-top">
                        {Array.from({ length: width }, (_, cellIndex) => (
                          <td key={cellIndex} className={cn("px-4 py-3 leading-relaxed", cellIndex === 0 ? "font-semibold text-[color:var(--ink)]" : "text-[color:var(--muted)]")}>
                            {row[cellIndex] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          if (!block.src) return null;
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={index} src={block.src} alt={block.alt ?? ""} loading="lazy" className="w-full rounded-2xl" />
          );
        })}
    </>
  );
}

export function ContactView({ site }: { site: EcomSite }) {
  return (
    <section className="wrap max-w-3xl py-14">
      <p className="eyebrow">Contact</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight">We answer.</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">
        Reach a person at {site.legalName} during {site.supportHours}. Email is answered within one business day.
      </p>

      <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-5">
        <div className="card p-6">
          <h2 className="text-[15px] font-bold">Email</h2>
          <a href={`mailto:${site.supportEmail}`} className="mt-2 block text-[14px] text-[color:var(--accent)] underline">
            {site.supportEmail}
          </a>
        </div>
        <div className="card p-6">
          <h2 className="text-[15px] font-bold">Phone</h2>
          <a href={`tel:${site.supportPhone.replace(/[^+\d]/g, "")}`} className="mt-2 block text-[14px] text-[color:var(--accent)] underline">
            {site.supportPhone}
          </a>
          <p className="mt-2 text-[13px] text-[color:var(--muted)]">{site.supportHours}</p>
        </div>
        <div className="card p-6 sm:col-span-2">
          <h2 className="text-[15px] font-bold">Registered address</h2>
          <address className="mt-2 not-italic text-[14px] text-[color:var(--muted)]">
            {site.legalName}
            <br />
            {fullAddress(site)}
            <br />
            {site.country}
          </address>
        </div>
      </div>

      {/* Le formulaire, sauf si la boutique l'a retiré. */}
      {site.contactForm === false ? null : (
        <div className="mt-6">
          <ContactForm slug={site.slug} email={site.supportEmail} />
        </div>
      )}
    </section>
  );
}

export function AboutView({ site }: { site: EcomSite }) {
  return (
    <section className="wrap max-w-3xl py-14">
      <p className="eyebrow">About</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight">
        {site.aboutStory?.heading || site.heroTitle || site.brandName}
      </h1>

      {site.aboutImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={site.aboutImageUrl}
          alt=""
          className="mt-8 aspect-[4/3] w-full rounded-3xl object-cover"
        />
      ) : null}

      {/* Le récit généré prend la place du texte de marque générique quand il
          existe : c'est la page qu'un analyste de souscription lit en entier. */}
      {site.aboutStory?.paragraphs?.length ? (
        site.aboutStory.paragraphs.map((paragraph) => (
          <p key={paragraph} className="mt-5 text-[15px] leading-relaxed whitespace-pre-line">
            {paragraph}
          </p>
        ))
      ) : (
        <>
          {site.promise ? <p className="mt-6 text-[16px] leading-relaxed whitespace-pre-line">{site.promise}</p> : null}
          {site.heroSubtitle ? (
            <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">{site.heroSubtitle}</p>
          ) : null}
        </>
      )}

      {site.aboutStory?.points?.length ? (
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {site.aboutStory.points.map((point) => (
            <div key={point.title} className="border-t border-[color:var(--line)] pt-5">
              <h2 className="text-[15px] font-bold">{point.title}</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">{point.body}</p>
            </div>
          ))}
        </div>
      ) : null}

      {site.pillars.length ? (
        <div className="mt-10 space-y-6">
          {site.pillars.map((pillar) => (
            <div key={pillar.title} className="border-t border-[color:var(--line)] pt-5">
              <h2 className="text-[16px] font-bold">{pillar.title}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">{pillar.body}</p>
            </div>
          ))}
        </div>
      ) : null}

      <p className="mt-12 border-t border-[color:var(--line)] pt-6 text-[13px] text-[color:var(--muted)]">
        {site.brandName} is a brand of {site.legalName}, {fullAddress(site)}, {site.country}.
      </p>
    </section>
  );
}

/* Bloc « PillarsBlock » de la page d'accueil. */
function PillarsBlock({ site, section }: { site: EcomSite; section: EcomSection }) {
  const title = section.title || `The ${site.brandName} difference`;
  return (
    <>
        {site.pillars.length ? (
          <section
      data-section-id={section.id}
      style={sectionStyle(section)}
      className={cn("reveal wrap", spaceClass(section.space), alignClass(section.align))}
    >
            <p className="eyebrow">{title}</p>
            {site.promise ? <p className="mt-4 max-w-3xl text-[20px] font-semibold leading-snug md:text-[26px]">{site.promise}</p> : null}
            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
              {site.pillars.map((pillar, index) => (
                <div key={pillar.title} className="border-t border-[color:var(--line)] pt-5">
                  <span className="text-[12px] font-bold text-[color:var(--accent)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-2 text-[16px] font-bold">{pillar.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">{pillar.body}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

    </>
  );
}

/* Bloc « CategoriesBlock » de la page d'accueil. */
function CategoriesBlock({ site, root, section }: { site: EcomSite; root: string; section: EcomSection }) {
  const title = section.title || "Find your routine.";
  return (
    <>
        {/* Les catégories en images.
            Elles étaient générées et jamais montrées — or c'est le bloc qui donne
            à une page d'accueil son air de vraie boutique : on entre par un
            univers, pas par une grille de produits. */}
        {site.categories.some((category) => category.imageUrl) ? (
          <section
      data-section-id={section.id}
      style={sectionStyle(section)}
      className={cn("reveal wrap", spaceClass(section.space), alignClass(section.align))}
    >
            <p className="eyebrow">Explore</p>
            <h2 className="mt-2 text-[28px] font-extrabold tracking-tight">{title}</h2>
            <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {site.categories
                .filter((category) => category.imageUrl)
                .map((category) => (
                  <a
                    key={category.id}
                    href={`${root}/shop?cat=${category.id}`}
                    className="group block overflow-hidden rounded-2xl"
                  >
                    <div className="aspect-[4/5] overflow-hidden bg-[color:var(--wash)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={category.imageUrl}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      />
                    </div>
                    <h3 className="mt-3 text-[15px] font-bold">{category.label}</h3>
                    {category.blurb ? (
                      <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">
                        {category.blurb}
                      </p>
                    ) : null}
                  </a>
                ))}
            </div>
          </section>
        ) : null}

    </>
  );
}

/* Bloc « LifestyleBlock » de la page d'accueil. */
function LifestyleBlock({ site, section }: { site: EcomSite; section: EcomSection }) {
  return (
    <>
        {/* Bande d'ambiance : elle sépare deux blocs de texte et donne à la page
            le rythme d'une vraie boutique plutôt que d'une liste. */}
        {site.lifestyleUrls?.length ? (
          <section
      data-section-id={section.id}
      style={sectionStyle(section)}
      className={cn("reveal wrap", spaceClass(section.space), alignClass(section.align))}
    >
            {/* Deux formats différents plutôt que deux carrés : un bloc régulier
                se lit comme une galerie, un bloc décalé comme une mise en page. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
              {site.lifestyleUrls.slice(0, 2).map((url, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt=""
                  data-image-key={`lifestyle:${index}`}
                  className={
                    index === 0
                      ? "aspect-[4/3] w-full rounded-3xl object-cover sm:col-span-3"
                      : "aspect-[4/3] w-full rounded-3xl object-cover sm:col-span-2 sm:aspect-auto sm:h-full"
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

    </>
  );
}

/* Bloc « FeaturedBlock » de la page d'accueil. */
function FeaturedBlock({ site, root, featured, section }: { site: EcomSite; root: string; featured: EcomProduct[]; section: EcomSection }) {
  const title = section.title || "Start with the heroes.";
  return (
    <>
        {featured.length ? (
          <section
      data-section-id={section.id}
      style={sectionStyle(section)}
      className={cn("reveal wrap", spaceClass(section.space), alignClass(section.align))}
    >
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">Featured</p>
                <h2 className="mt-2 text-[28px] font-extrabold tracking-tight">{title}</h2>
              </div>
              <a href={`${root}/shop`} className="text-[13px] font-semibold underline underline-offset-4">
                Shop all {site.products.length}
              </a>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
              {featured.map((product) => (
                <ProductCard key={product.handle} site={site} product={product} />
              ))}
            </div>
          </section>
        ) : null}

    </>
  );
}

/* Bloc « ReviewsBlock » de la page d'accueil. */
function ReviewsBlock({ site, section }: { site: EcomSite; section: EcomSection }) {
  return (
    <>
        {site.testimonials.length ? (
          <section
      data-section-id={section.id}
      style={sectionStyle(section)}
      className={cn("reveal bg-[color:var(--sand)]", spaceClass(section.space), alignClass(section.align))}
    >
            <div className="wrap">
              <p className="eyebrow">From our customers</p>
              <div className="mt-8 grid gap-6 md:grid-cols-3">
                {site.testimonials.map((testimonial) => (
                  <blockquote key={testimonial.author} className="card p-6">
                    <p className="text-[14px] leading-relaxed whitespace-pre-line">&ldquo;{testimonial.body}&rdquo;</p>
                    <footer className="mt-4 text-[12px] font-semibold text-[color:var(--muted)]">
                      {testimonial.author}
                      {testimonial.detail ? ` · ${testimonial.detail}` : ""}
                    </footer>
                  </blockquote>
                ))}
              </div>
            </div>
          </section>
        ) : null}

    </>
  );
}

/**
 * Le récit de marque sur la page d'accueil.
 *
 * C'est le bloc qui manque le plus à une boutique fraîchement montée : sans
 * lui, la page enchaîne des produits sans jamais dire qui les vend. En
 * souscription, c'est exactement ce qui distingue une vitrine d'un commerce.
 */
function AboutBlock({ site, root, section }: { site: EcomSite; root: string; section: EcomSection }) {
  const story = site.aboutStory;
  if (!story?.paragraphs?.length) return null;

  return (
    <section
      data-section-id={section.id}
      style={sectionStyle(section)}
      className={cn("reveal wrap", spaceClass(section.space), alignClass(section.align))}
    >
      <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
        {site.aboutImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={site.aboutImageUrl}
            alt=""
            data-image-key="about"
            className="aspect-[4/3] w-full rounded-3xl object-cover"
          />
        ) : null}
        <div>
          <p className="eyebrow">Our story</p>
          <h2 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight md:text-[30px]">
            {story.heading}
          </h2>
          {story.paragraphs.slice(0, 2).map((paragraph) => (
            <p key={paragraph} className="mt-4 text-[14px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">
              {paragraph}
            </p>
          ))}
          <a href={`${root}/about`} className="btn-ghost mt-6 inline-flex">
            Read more about us
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * Bloc de texte libre.
 *
 * Ce que le site ne sait pas produire tout seul : un mot du fondateur, une
 * note sur l'expédition, une précision réglementaire. Il se pose où l'on veut
 * dans la page et se règle comme les autres.
 */
/* Le bandeau de réassurance : livraison, retours, support — et le reste.

   Il était écrit en dur au bas de l'accueil, avec exactement trois cartes
   déduites des réglages de la boutique. Or c'est le bloc qu'on veut ajuster le
   plus vite : une marque promet un paiement sécurisé, une autre un fabriqué
   aux États-Unis. Il passe donc par les sections, comme les autres. */
function AssurancesBlock({ site, section }: { site: EcomSite; section: EcomSection }) {
  const items = assuranceItems(site, section);
  if (!items.length) return null;

  return (
    <section
      data-section-id={section.id}
      style={sectionStyle(section)}
      className={cn("reveal wrap", spaceClass(section.space), alignClass(section.align))}
    >
      {section.title ? <p className="eyebrow mb-6">{section.title}</p> : null}
      <div className={cn("grid gap-6 sm:grid-cols-2", assuranceCols(items.length))}>
        {items.map((item, index) => (
          <div key={`${item.title}-${index}`} className="card p-6">
            <h3 className="text-[15px] font-bold">{item.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* Une rangée pleine plutôt qu'une carte esseulée en bout de ligne. */
function assuranceCols(count: number) {
  if (count === 1) return "sm:grid-cols-1 md:grid-cols-1";
  if (count === 2) return "md:grid-cols-2";
  if (count % 4 === 0) return "md:grid-cols-4";
  return "md:grid-cols-3";
}

function FreeTextBlock({ section }: { section: EcomSection }) {
  if (!section.title && !section.body) return null;
  return (
    <section
      data-section-id={section.id}
      style={sectionStyle(section)}
      className={cn("reveal wrap", spaceClass(section.space), alignClass(section.align))}
    >
      <div className="max-w-3xl">
        {section.title ? (
          <h2 className="text-[26px] font-extrabold leading-tight tracking-tight md:text-[30px]">
            {section.title}
          </h2>
        ) : null}
        {section.body
          ? section.body.split(/\n{2,}/).map((paragraph) => (
              <p key={paragraph} className="mt-4 text-[15px] leading-relaxed text-[color:var(--muted)] whitespace-pre-line">
                {paragraph}
              </p>
            ))
          : null}
      </div>
    </section>
  );
}

/** Bloc d'image libre : une bannière, un visuel validé qu'on veut ailleurs. */
function FreeImageBlock({ section }: { section: EcomSection }) {
  if (!section.imageUrl) return null;
  return (
    <section
      data-section-id={section.id}
      style={sectionStyle(section)}
      className={cn("reveal wrap", spaceClass(section.space))}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={section.imageUrl}
        alt={section.title || ""}
        data-image-key={`section:${section.id}`}
        className="w-full rounded-3xl object-cover"
      />
      {section.title ? (
        <p className={cn("mt-3 text-[13px] text-[color:var(--muted)]", alignClass(section.align))}>
          {section.title}
        </p>
      ) : null}
    </section>
  );
}
