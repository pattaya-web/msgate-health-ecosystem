import type { BankPage } from "@/lib/bank-pages/types";
import { themeOf } from "@/lib/bank-pages/types";

export function BankPageView({ page }: { page: BankPage }) {
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

  return (
    <div className="bank-site min-h-screen bg-white text-[15px] antialiased" style={vars}>
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
      `}</style>

      <header className="sticky top-0 z-40 border-b border-[color:var(--line)]/70 bg-white/80 backdrop-blur-sm">
        <div className="wrap flex h-14 items-center justify-between md:h-16">
          {page.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.logoDataUrl} alt={page.brandName} className="h-[19px] max-w-[152px] object-contain object-left" />
          ) : (
            <span className="text-[15px] font-semibold tracking-tight">{page.brandName}</span>
          )}
          <nav className="hidden items-center gap-0.5 text-[13px] font-semibold text-[color:var(--ink)]/70 lg:flex">
            {["Home", "Services", "Results", "About", "Contact"].map((item) => (
              <a key={item} href={`#${item.toLowerCase()}`} className="rounded-md px-3 py-2 hover:bg-[color:var(--blue-wash)]">
                {item}
              </a>
            ))}
          </nav>
          <a href="#contact" className="btn hidden text-[13px] lg:inline-flex">
            Get in touch
          </a>
        </div>
      </header>

      <section id="home" className="wrap grid gap-10 py-14 md:grid-cols-[1.12fr_0.88fr] md:py-[72px]">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]">
            {page.brandName} · {page.tagline}
          </p>
          <h1 className="mt-3 text-[34px] font-semibold leading-[1.12] tracking-[-0.035em] md:text-[48px]">
            {page.heroTitle}
          </h1>
          <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-[color:var(--ink-soft)]">{page.heroSubtitle}</p>
          <a href="#contact" className="btn mt-7">
            Get in touch
          </a>
          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {page.stats.map((stat) => (
              <div key={stat.label}>
                <p className="text-[22px] font-semibold tracking-tight">{stat.value}</p>
                <p className="text-[12px] text-[color:var(--ink-soft)]">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-3">
          {[
            ["Operators on the keys", "No telephone game. The strategist who plans is the buyer who ships weekly changes."],
            ["Margin is the scoreboard", "We judge campaigns on contribution margin and cash efficiency — screenshots don’t pay rent."],
            ["Creative with a cadence", "Angles, hooks, and kill criteria. Winners get budget; losers get cut — on a fixed rhythm."],
          ].map(([title, body]) => (
            <article key={title} className="rounded-2xl bg-[color:var(--blue-wash)] p-5 ring-1 ring-[color:var(--line)]">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--blue-deep)]">US DTC</p>
              <h3 className="mt-1 text-[16px] font-semibold">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[color:var(--ink-soft)]">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="services" className="border-t border-[color:var(--line)] bg-[color:var(--surface)] py-14">
        <div className="wrap">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]">Services</p>
          <h2 className="mt-2 text-[28px] font-semibold tracking-tight">Acquisition levers we run</h2>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--ink-soft)]">
            Pick Meta, TikTok, store conversion, or brand systems — alone or as one stack.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {page.services.map((service) => (
              <article key={service.title} className="rounded-2xl bg-white p-5 ring-1 ring-[color:var(--line)]">
                <h3 className="text-[16px] font-semibold">{service.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-soft)]">{service.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="results" className="wrap py-14">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]">Results</p>
        <h2 className="mt-2 text-[28px] font-semibold tracking-tight">Numbers that survive a P&L review</h2>
        <p className="mt-2 max-w-2xl text-sm text-[color:var(--ink-soft)]">
          Illustrative outcomes from acquisition work — ROAS held while scaling, margin recovered, creative systems that compound.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {page.results.map((result) => (
            <article key={result.brand} className="rounded-2xl bg-[color:var(--surface)] p-5 ring-1 ring-[color:var(--line)]">
              <p className="text-[12px] font-medium text-[color:var(--ink-soft)]">{result.brand}</p>
              <p className="mt-2 text-[28px] font-semibold tracking-tight">{result.metric}</p>
              <p className="text-sm font-medium">{result.detail}</p>
              <p className="mt-1 text-[12px] text-[color:var(--ink-soft)]">{result.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="about" className="border-t border-[color:var(--line)] bg-[color:var(--surface)] py-14">
        <div className="wrap grid gap-10 md:grid-cols-2">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]">About</p>
            <h2 className="mt-2 text-[28px] font-semibold tracking-tight">A performance partner built on clarity</h2>
            <p className="mt-4 text-sm leading-relaxed text-[color:var(--ink-soft)]">
              {page.brandName} is the growth brand of {page.legalName}. We exist for one reason: help DTC brands buy
              customers on Meta and TikTok without guessing — and without hiding behind vanity metrics.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[color:var(--ink-soft)]">
              Our objective is simple and measurable: improve the economics of acquisition. That means protecting
              contribution margin, shortening payback where we can, and telling you early when spend should pause — not
              only when it should rise.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[color:var(--ink-soft)]">
              Transparency is non-negotiable. Shared dashboards, weekly written notes, and open access to what we tested,
              what failed, and what we will try next. You stay in control of the strategy; we own the execution speed.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-[color:var(--ink-soft)]">
              <li>Objective: profitable customer acquisition — not just more spend.</li>
              <li>Transparency: shared numbers, weekly notes, and honest kill decisions.</li>
              <li>Focus: US DTC brands scaling on Meta and TikTok with clean tracking.</li>
            </ul>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Radical transparency", "You see the same numbers we do: spend, CAC, ROAS, and contribution margin — explained in plain English every week."],
              ["Clear objectives", "We set targets before we scale: payback window, margin floor, and creative volume. No vague “brand awareness” escapes."],
              ["Operator accountability", "The team that plans the week also ships the changes. You always know who owns the next test."],
              ["Registered US company", `${page.legalName} · professional billing and contracts.`],
            ].map(([title, body]) => (
              <article key={title} className="rounded-2xl bg-white p-4 ring-1 ring-[color:var(--line)]">
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--ink-soft)]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap py-14">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]">Process</p>
        <h2 className="mt-2 text-[28px] font-semibold tracking-tight">Diagnose → install → pressure-test → compound</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["01", "Diagnose", "Tracking, creative library, and unit economics — we map what actually blocks profitable scale."],
            ["02", "Install", "Clean structure, first angle batch, and guardrails so spend has a job from day one."],
            ["03", "Pressure-test", "Small controlled bets across hooks and audiences until winners prove they hold."],
            ["04", "Compound", "Scale winners, kill losers weekly, and report against margin — not vanity ROAS alone."],
          ].map(([n, title, body]) => (
            <article key={n} className="rounded-2xl p-5 ring-1 ring-[color:var(--line)]">
              <p className="text-[12px] font-semibold text-[color:var(--blue)]">{n}</p>
              <h3 className="mt-2 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-[color:var(--ink-soft)]">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-[color:var(--line)] bg-[color:var(--surface)] py-14">
        <div className="wrap">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--blue-deep)]">Blog</p>
          <h2 className="mt-2 text-[28px] font-semibold tracking-tight">Latest from the growth floor</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              ["Maximizing ROAS without killing contribution margin", "Guessing is expensive. Here’s how DTC brands should read ROAS, CAC, and margin together before they scale another dollar."],
              ["Brand storytelling that converts — without the fluff", "Shoppers don’t buy logos. They buy trust. Here’s how narrative, proof, and paid creative work together for DTC brands."],
              ["The playbook: Meta & TikTok as a power duo", "One product isn’t enough anymore. Here’s how to run Meta and TikTok as one acquisition system — with roles, budgets, and creative that compound."],
            ].map(([title, body]) => (
              <article key={title} className="rounded-2xl bg-white p-5 ring-1 ring-[color:var(--line)]">
                <h3 className="text-[15px] font-semibold leading-snug">{title}</h3>
                <p className="mt-2 text-[12px] text-[color:var(--ink-soft)]">
                  {page.brandName} · growth notes
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-soft)]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="border-t border-[color:var(--line)] bg-[color:var(--ink)] py-14 text-white">
        <div className="wrap grid gap-10 md:grid-cols-2">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/50">Get in touch</p>
            <h2 className="mt-2 text-[28px] font-semibold tracking-tight">Ready to grow your brand?</h2>
            <p className="mt-3 text-sm text-white/70">
              Let’s review your Meta & TikTok setup and show where growth is blocked — then how to unlock it.
            </p>
            <p className="mt-6 text-sm text-white/80">
              <span className="block text-[11px] uppercase tracking-wide text-white/45">Phone</span>
              {page.phone}
              <span className="mt-3 block text-[11px] uppercase tracking-wide text-white/45">Email</span>
              {page.email}
              <span className="mt-3 block text-[11px] uppercase tracking-wide text-white/45">Address</span>
              {page.addressLine}
              <br />
              {page.city}, {page.region} {page.postalCode}
              <br />
              {page.country}
            </p>
          </div>
          <form className="grid gap-3" action={`mailto:${page.email}`} method="post" encType="text/plain">
            <p className="text-[18px] font-semibold">Ready to grow your business?</p>
            <p className="text-[13px] text-white/60">
              Fill out the form and we’ll get back within 24 hours. Prefer email? {page.email}
            </p>
            <input name="name" placeholder="Full name" />
            <input name="email" placeholder="Email" type="email" />
            <input name="site" placeholder="Website / store URL" />
            <select name="spend" defaultValue="">
              <option value="" disabled>
                Monthly ad spend
              </option>
              <option>Under $5k / month</option>
              <option>$5k – $15k / month</option>
              <option>$15k – $50k / month</option>
              <option>$50k – $100k / month</option>
              <option>$100k+ / month</option>
            </select>
            <textarea className="min-h-24" name="message" placeholder="Message" />
            <button className="btn mt-1 w-fit" type="submit">
              Send message
            </button>
          </form>
        </div>
      </section>

      <footer className="bg-[color:var(--ink)] pb-8 text-center text-[11px] text-white/40">
        {page.legalName} · {page.country}
      </footer>
    </div>
  );
}
