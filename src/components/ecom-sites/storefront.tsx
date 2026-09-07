import type { CSSProperties, ReactNode } from "react";
import { AddToCartButton, CartLink, CartProvider } from "@/components/ecom-sites/cart";
import { POLICY_LABELS, POLICY_SLUGS, type PolicyDoc } from "@/lib/ecom-sites/policies";
import { fullAddress, money, sitePalette, type EcomProduct, type EcomSite } from "@/lib/ecom-sites/types";

/* ------------------------------------------------------------------ *
 * Coquille : barre promo, header, footer.
 * Le footer porte tout ce que l'underwriting recoupe — raison sociale,
 * adresse, e-mail, téléphone, horaires, descripteur de facturation.
 * ------------------------------------------------------------------ */

function base(site: EcomSite) {
  return `/s/${site.slug}`;
}

const NAV = [
  { label: "Shop", path: "/shop" },
  { label: "About", path: "/about" },
  { label: "Shipping", path: "/shipping-policy" },
  { label: "Returns", path: "/refund-policy" },
  { label: "Contact", path: "/contact" },
];

export function Storefront({ site, children }: { site: EcomSite; children: ReactNode }) {
  // Les deux couleurs de marque priment sur le thème quand elles sont posées.
  const theme = sitePalette(site.themeId, site.brandColors);
  const root = base(site);
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
      <style>{`
        .shopfront { color: var(--ink); font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif; }
        .shopfront .wrap { margin: 0 auto; max-width: 1180px; padding: 0 20px; }
        .shopfront a { color: inherit; text-decoration: none; }
        .shopfront .btn {
          display:inline-flex; align-items:center; justify-content:center; gap:8px;
          border-radius:999px; background:var(--accent); color:#fff; font-weight:650;
          padding:12px 24px; letter-spacing:-0.01em; transition:filter .15s ease;
        }
        .shopfront .btn:hover { filter: brightness(1.06); }
        .shopfront .btn-ghost {
          display:inline-flex; align-items:center; justify-content:center;
          border-radius:999px; border:1px solid var(--ink); padding:11px 23px; font-weight:650;
        }
        .shopfront .eyebrow {
          font-size:11px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--accent);
        }
        .shopfront .card { border:1px solid var(--line); border-radius:18px; background:#fff; overflow:hidden; }
        @keyframes shopfront-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .shopfront .marquee-track { display:flex; width:max-content; animation: shopfront-marquee 32s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .shopfront .marquee-track { animation: none; } }
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
        <div className="wrap flex h-16 items-center justify-between gap-4">
          <a href={root} className="flex items-center gap-2">
            {site.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.logoDataUrl} alt={site.brandName} className="h-7 max-w-[168px] object-contain object-left" />
            ) : (
              <span className="text-[17px] font-bold tracking-tight">{site.brandName}</span>
            )}
          </a>
          <nav className="hidden items-center gap-1 text-[13px] font-semibold text-[color:var(--muted)] md:flex">
            {NAV.map((item) => (
              <a key={item.path} href={`${root}${item.path}`} className="rounded-full px-3 py-2 hover:bg-[color:var(--wash)] hover:text-[color:var(--ink)]">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <CartLink slug={site.slug} />
            <a href={`${root}/shop`} className="btn text-[13px]">
              Shop now
            </a>
          </div>
        </div>
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

  return (
    <footer className="mt-20 border-t border-[color:var(--line)] bg-[color:var(--sand)]">
      <div className="wrap py-14">
        {/* Phrase d'identité : le premier endroit où un underwriter cherche la LLC. */}
        <p className="max-w-3xl text-[13px] leading-relaxed text-[color:var(--muted)]">
          <strong className="text-[color:var(--ink)]">{site.domain || site.brandName}</strong> is owned and operated by{" "}
          <strong className="text-[color:var(--ink)]">{site.legalName}</strong>
          {site.stateOfIncorporation ? `, a ${site.stateOfIncorporation} limited liability company` : ""} headquartered at{" "}
          <strong className="text-[color:var(--ink)]">
            {fullAddress(site)}
            {site.country ? `, ${site.country}` : ""}
          </strong>
          .
        </p>

        <div className="mt-10 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <h3 className="eyebrow">Legal</h3>
            <ul className="mt-3 space-y-2 text-[13px] text-[color:var(--muted)]">
              {POLICY_SLUGS.map((slug) => (
                <li key={slug}>
                  <a href={`${root}/${slug}`} className="hover:text-[color:var(--ink)]">
                    {POLICY_LABELS[slug]}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="eyebrow">Store</h3>
            <ul className="mt-3 space-y-2 text-[13px] text-[color:var(--muted)]">
              <li><a href={`${root}/shop`} className="hover:text-[color:var(--ink)]">Shop</a></li>
              <li><a href={`${root}/about`} className="hover:text-[color:var(--ink)]">About</a></li>
              <li><a href={`${root}/contact`} className="hover:text-[color:var(--ink)]">Contact</a></li>
            </ul>
          </div>

          {/* Bloc contact : nom, adresse, téléphone et e-mail, cliquables. */}
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
        </div>

        {site.billingDescriptor ? (
          <p className="mt-10 rounded-xl border border-[color:var(--line)] bg-white px-4 py-3 text-[12px] text-[color:var(--muted)]">
            A charge will appear on your credit card statement with the billing descriptor{" "}
            <strong className="text-[color:var(--ink)]">&ldquo;{site.billingDescriptor}&rdquo;</strong>.
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 border-t border-[color:var(--line)] pt-6 text-[12px] text-[color:var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {site.brandName}
            {site.legalName ? ` — a brand of ${site.legalName}` : ""}.
          </p>
          <p className="flex items-center gap-2 font-semibold tracking-wide">
            <span>VISA</span><span>MASTERCARD</span><span>AMEX</span>
          </p>
        </div>

        {site.productDisclaimer ? (
          <p className="mt-4 text-[11px] leading-relaxed text-[color:var(--muted)]">{site.productDisclaimer}</p>
        ) : null}
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ *
 * Carte produit
 * ------------------------------------------------------------------ */

export function ProductCard({ site, product }: { site: EcomSite; product: EcomProduct }) {
  return (
    <a href={`${base(site)}/product/${product.handle}`} className="card group flex flex-col">
      <div className="relative aspect-square bg-[color:var(--wash)]">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
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
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {product.dosage ? (
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted)]">{product.dosage}</span>
        ) : null}
        <h3 className="text-[15px] font-bold leading-snug">{product.name}</h3>
        {product.subtitle ? <p className="text-[13px] text-[color:var(--muted)]">{product.subtitle}</p> : null}
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

  return (
    <>
      <section className="bg-[color:var(--wash)]">
        <div className="wrap grid items-center gap-10 py-16 md:grid-cols-2 md:py-24">
          <div>
            {site.tagline ? <p className="eyebrow">{site.tagline}</p> : null}
            <h1 className="mt-3 text-[38px] font-extrabold leading-[1.05] tracking-tight md:text-[52px]">
              {site.heroTitle || site.brandName}
            </h1>
            {site.heroSubtitle ? (
              <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-[color:var(--muted)]">{site.heroSubtitle}</p>
            ) : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={`${root}/shop`} className="btn">Shop the line</a>
              <a href={`${root}/about`} className="btn-ghost">Learn more</a>
            </div>
          </div>
          {featured[0]?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={featured[0].imageUrl} alt={featured[0].name} className="w-full rounded-3xl object-cover" />
          ) : (
            <div className="aspect-square rounded-3xl bg-white/60" />
          )}
        </div>
      </section>

      {site.pillars.length ? (
        <section className="wrap py-16 md:py-20">
          <p className="eyebrow">The {site.brandName} difference</p>
          {site.promise ? <p className="mt-4 max-w-3xl text-[20px] font-semibold leading-snug md:text-[26px]">{site.promise}</p> : null}
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {site.pillars.map((pillar, index) => (
              <div key={pillar.title} className="border-t border-[color:var(--line)] pt-5">
                <span className="text-[12px] font-bold text-[color:var(--accent)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 text-[16px] font-bold">{pillar.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--muted)]">{pillar.body}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {featured.length ? (
        <section className="wrap pb-16 md:pb-20">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Featured</p>
              <h2 className="mt-2 text-[28px] font-extrabold tracking-tight">Start with the heroes.</h2>
            </div>
            <a href={`${root}/shop`} className="text-[13px] font-semibold underline underline-offset-4">
              Shop all {site.products.length}
            </a>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((product) => (
              <ProductCard key={product.handle} site={site} product={product} />
            ))}
          </div>
        </section>
      ) : null}

      {site.testimonials.length ? (
        <section className="bg-[color:var(--sand)] py-16">
          <div className="wrap">
            <p className="eyebrow">From our customers</p>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {site.testimonials.map((testimonial) => (
                <blockquote key={testimonial.author} className="card p-6">
                  <p className="text-[14px] leading-relaxed">&ldquo;{testimonial.body}&rdquo;</p>
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

      <section className="wrap grid gap-6 py-16 md:grid-cols-3">
        {[
          site.freeShippingThreshold > 0
            ? { title: "Free US shipping", body: `On orders over ${money(site.freeShippingThreshold, site.currency)}. Tracked end to end.` }
            : { title: "Tracked US shipping", body: "Every order ships with tracking." },
          { title: `${site.returnWindowDays}-day returns`, body: "Not right for you? We send a prepaid label." },
          { title: "Real people on support", body: `${site.supportHours || "Weekdays"} — phone and email.` },
        ].map((item) => (
          <div key={item.title} className="card p-6">
            <h3 className="text-[15px] font-bold">{item.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--muted)]">{item.body}</p>
          </div>
        ))}
      </section>
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

      {shown.length ? (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
    <section className="wrap grid gap-12 py-14 md:grid-cols-2">
      <div className="card aspect-square bg-[color:var(--wash)]">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
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

        {product.description ? (
          <p className="mt-5 text-[14px] leading-relaxed text-[color:var(--muted)]">{product.description}</p>
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

        <AddToCartButton product={product} />

        <dl className="mt-8 space-y-4 border-t border-[color:var(--line)] pt-6 text-[13px]">
          {product.usage ? (
            <div>
              <dt className="font-bold">How to use</dt>
              <dd className="mt-1 text-[color:var(--muted)]">{product.usage}</dd>
            </div>
          ) : null}
          {product.ingredients ? (
            <div>
              <dt className="font-bold">Ingredients</dt>
              <dd className="mt-1 text-[color:var(--muted)]">{product.ingredients}</dd>
            </div>
          ) : null}
          <div>
            <dt className="font-bold">Shipping &amp; returns</dt>
            <dd className="mt-1 text-[color:var(--muted)]">
              Ships from {site.shipsFrom}. Delivery {site.deliveryMinDays}–{site.deliveryMaxDays} business days.{" "}
              {site.returnWindowDays}-day returns.
            </dd>
          </div>
        </dl>
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
          <div key={section.heading}>
            <h2 className="text-[17px] font-bold">{section.heading}</h2>
            {section.body.map((paragraph, index) => (
              <p key={index} className="mt-3 text-[14px] leading-relaxed text-[color:var(--muted)]">
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

export function ContactView({ site }: { site: EcomSite }) {
  return (
    <section className="wrap max-w-3xl py-14">
      <p className="eyebrow">Contact</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight">We answer.</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--muted)]">
        Reach a person at {site.legalName} during {site.supportHours}. Email is answered within one business day.
      </p>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
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
    </section>
  );
}

export function AboutView({ site }: { site: EcomSite }) {
  return (
    <section className="wrap max-w-3xl py-14">
      <p className="eyebrow">About</p>
      <h1 className="mt-2 text-[32px] font-extrabold tracking-tight">{site.heroTitle || site.brandName}</h1>
      {site.promise ? <p className="mt-6 text-[16px] leading-relaxed">{site.promise}</p> : null}
      {site.heroSubtitle ? (
        <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--muted)]">{site.heroSubtitle}</p>
      ) : null}

      {site.pillars.length ? (
        <div className="mt-10 space-y-6">
          {site.pillars.map((pillar) => (
            <div key={pillar.title} className="border-t border-[color:var(--line)] pt-5">
              <h2 className="text-[16px] font-bold">{pillar.title}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--muted)]">{pillar.body}</p>
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
