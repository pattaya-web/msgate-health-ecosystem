"use client";

/**
 * Panier client, stocké par boutique dans le navigateur du visiteur.
 *
 * Le tunnel va jusqu'au bout : la commande part au serveur, reçoit un numéro et
 * s'affiche en confirmation. Seul l'encaissement manque, et c'est volontaire —
 * aucun champ carte n'est demandé tant que la passerelle n'est pas branchée,
 * parce que collecter un numéro qu'on ne peut pas traiter serait le collecter
 * sous un faux prétexte. Un souscripteur qui teste la boutique doit pouvoir
 * aller jusqu'à la confirmation : un bouton « Place order » grisé se lit comme
 * une boutique qui ne marche pas, et c'est un motif de refus.
 */

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";
import { money, type EcomProduct, type EcomSite } from "@/lib/ecom-sites/types";

export type CartLine = { handle: string; name: string; price: number; image: string; qty: number };

/* ------------------------------------------------------------------ *
 * Le panier vit dans le localStorage, qui est une source externe à React :
 * useSyncExternalStore le lit sans effet et sans écart d'hydratation, et
 * propage la mise à jour à tous les composants montés (header, page panier).
 * ------------------------------------------------------------------ */

const EMPTY: CartLine[] = [];
const snapshots = new Map<string, CartLine[]>();
const listeners = new Map<string, Set<() => void>>();

function storageKey(slug: string) {
  return `shopfront-cart:${slug}`;
}

/** Doit renvoyer la même référence tant que rien n'a changé. */
function readCart(slug: string): CartLine[] {
  const cached = snapshots.get(slug);
  if (cached) return cached;
  let lines: CartLine[] = EMPTY;
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    const parsed = raw ? (JSON.parse(raw) as CartLine[]) : null;
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    // navigation privée ou stockage bloqué : panier en mémoire
  }
  snapshots.set(slug, lines);
  return lines;
}

function writeCart(slug: string, lines: CartLine[]) {
  snapshots.set(slug, lines);
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(lines));
  } catch {
    // idem
  }
  listeners.get(slug)?.forEach((notify) => notify());
}

function subscribeCart(slug: string, notify: () => void) {
  let set = listeners.get(slug);
  if (!set) {
    set = new Set();
    listeners.set(slug, set);
  }
  set.add(notify);
  return () => {
    set.delete(notify);
  };
}

type CartState = {
  lines: CartLine[];
  add: (product: EcomProduct, qty?: number) => void;
  setQty: (handle: string, qty: number) => void;
  remove: (handle: string) => void;
  clear: () => void;
  count: number;
  subtotal: number;
};

const CartContext = createContext<CartState | null>(null);

export function CartProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const lines = useSyncExternalStore(
    useCallback((notify: () => void) => subscribeCart(slug, notify), [slug]),
    useCallback(() => readCart(slug), [slug]),
    // Le serveur ne voit aucun panier : il rend la boutique vide.
    useCallback(() => EMPTY, [])
  );

  const add = useCallback(
    (product: EcomProduct, qty = 1) => {
      const current = readCart(slug);
      const existing = current.find((line) => line.handle === product.handle);
      writeCart(
        slug,
        existing
          ? current.map((line) =>
              line.handle === product.handle ? { ...line, qty: line.qty + qty } : line
            )
          : [
              ...current,
              { handle: product.handle, name: product.name, price: product.price, image: product.imageUrl, qty },
            ]
      );
    },
    [slug]
  );

  const setQty = useCallback(
    (handle: string, qty: number) => {
      const current = readCart(slug);
      writeCart(
        slug,
        qty <= 0
          ? current.filter((line) => line.handle !== handle)
          : current.map((line) => (line.handle === handle ? { ...line, qty } : line))
      );
    },
    [slug]
  );

  const remove = useCallback(
    (handle: string) => {
      writeCart(slug, readCart(slug).filter((line) => line.handle !== handle));
    },
    [slug]
  );

  const clear = useCallback(() => writeCart(slug, EMPTY), [slug]);

  const value = useMemo<CartState>(() => {
    const count = lines.reduce((sum, line) => sum + line.qty, 0);
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
    return { lines, add, setQty, remove, clear, count, subtotal };
  }, [lines, add, setQty, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart doit être utilisé dans un CartProvider");
  return context;
}

/* ------------------------------------------------------------------ */

export function CartLink({ slug }: { slug: string }) {
  const { count } = useCart();
  return (
    <a href={`/s/${slug}/cart`} className="relative rounded-full px-3 py-2 text-[13px] font-semibold">
      Cart
      {count > 0 ? (
        <span className="ml-1 rounded-full bg-[color:var(--accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">
          {count}
        </span>
      ) : null}
    </a>
  );
}

export function AddToCartButton({ product }: { product: EcomProduct }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        add(product);
        setAdded(true);
        window.setTimeout(() => setAdded(false), 1600);
      }}
      className="btn mt-8 w-full sm:w-auto"
    >
      {added ? "Added to cart" : "Add to cart"}
    </button>
  );
}

/* ------------------------------------------------------------------ */

function shippingFor(site: EcomSite, subtotal: number) {
  if (site.freeShippingThreshold > 0 && subtotal >= site.freeShippingThreshold) return 0;
  if (subtotal === 0) return 0;
  return 4.95;
}

export function CartView({ site }: { site: EcomSite }) {
  const { lines, setQty, remove, subtotal } = useCart();
  const shipping = shippingFor(site, subtotal);

  if (!lines.length) {
    return (
      <section className="wrap max-w-3xl py-16 text-center">
        <h1 className="text-[30px] font-extrabold tracking-tight">Your cart is empty</h1>
        <p className="mt-3 text-[14px] text-[color:var(--muted)]">Nothing here yet.</p>
        <a href={`/s/${site.slug}/shop`} className="btn mt-8">Shop the line</a>
      </section>
    );
  }

  return (
    <section className="wrap max-w-4xl py-14">
      <h1 className="text-[30px] font-extrabold tracking-tight">Your cart</h1>

      <div className="mt-8 space-y-3">
        {lines.map((line) => (
          /*
           * La ligne se replie sur un téléphone.
           *
           * Les cinq colonnes tenaient côte à côte quelle que soit la largeur :
           * à 390 px le nom du produit tombait à un mot par ligne et la ligne
           * faisait la moitié de l'écran de haut. La photo et le libellé
           * occupent maintenant la première rangée, la quantité et le total la
           * seconde, et tout se remet en ligne dès qu'il y a la place.
           */
          <div
            key={line.handle}
            className="card grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 p-3 sm:flex sm:gap-4"
          >
            {line.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={line.image} alt={line.name} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded-lg bg-[color:var(--wash)]" />
            )}
            <div className="min-w-0 sm:flex-1">
              <p className="text-[14px] font-bold leading-snug">{line.name}</p>
              <p className="text-[13px] text-[color:var(--muted)]">{money(line.price, site.currency)}</p>
            </div>
            <div className="col-span-2 flex items-center justify-between gap-3 sm:col-auto sm:contents">
              <input
                type="number"
                min={1}
                value={line.qty}
                onChange={(event) => setQty(line.handle, Number(event.target.value))}
                className="h-10 w-16 shrink-0 rounded-lg border border-[color:var(--line)] px-2 text-center text-[13px]"
                aria-label={`Quantity for ${line.name}`}
              />
              <p className="text-[14px] font-bold sm:w-20 sm:text-right">
                {money(line.price * line.qty, site.currency)}
              </p>
              {/* Une cible de 40 px : un lien de 12 px se rate au pouce. */}
              <button
                type="button"
                onClick={() => remove(line.handle)}
                className="flex h-10 shrink-0 items-center px-1 text-[12px] text-[color:var(--muted)] underline"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 ml-auto max-w-sm space-y-2 text-[14px]">
        <Row label="Subtotal" value={money(subtotal, site.currency)} />
        <Row label="Shipping" value={shipping === 0 ? "Free" : money(shipping, site.currency)} />
        <div className="border-t border-[color:var(--line)] pt-2">
          <Row label="Total" value={money(subtotal + shipping, site.currency)} strong />
        </div>
        <a href={`/s/${site.slug}/checkout`} className="btn mt-4 w-full">Checkout</a>
        <p className="pt-2 text-center text-[12px] text-[color:var(--muted)]">
          Delivery {site.deliveryMinDays}–{site.deliveryMaxDays} business days · {site.returnWindowDays}-day returns
        </p>
      </div>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-extrabold" : "text-[color:var(--muted)]"}`}>
      <span>{label}</span>
      <span className={strong ? "" : "text-[color:var(--ink)]"}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const input =
  "h-11 w-full rounded-lg border border-[color:var(--line)] bg-white px-3 text-[14px] outline-none focus:border-[color:var(--accent)]";

type PlacedOrder = { number: string; total: number; email: string };

export function CheckoutView({ site }: { site: EcomSite }) {
  const { lines, subtotal, clear } = useCart();
  const shipping = shippingFor(site, subtotal);
  const total = subtotal + shipping;
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [failed, setFailed] = useState("");

  async function placeOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || "").trim();

    setPlacing(true);
    setFailed("");
    try {
      const res = await fetch("/api/ecom-sites/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: site.slug,
          email: value("email"),
          phone: value("phone"),
          name: `${value("firstName")} ${value("lastName")}`.trim(),
          address: [value("address1"), value("address2")].filter(Boolean).join(", "),
          city: value("city"),
          state: value("state"),
          zip: value("zip"),
          // Le serveur relit les prix : on ne lui envoie que quoi et combien.
          lines: lines.map((line) => ({ handle: line.handle, qty: line.qty })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Order could not be placed");
      setPlaced({ number: body.order.number, total: body.order.total, email: value("email") });
      clear();
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "Order could not be placed");
    } finally {
      setPlacing(false);
    }
  }

  /* Confirmation : le numéro d'abord, c'est ce qu'on redonne au support. */
  if (placed) {
    return (
      <section className="wrap max-w-2xl py-16 text-center">
        <p className="eyebrow">Order confirmed</p>
        <h1 className="mt-3 text-[32px] font-extrabold tracking-tight">Thank you</h1>
        <p className="mt-4 text-[15px] text-[color:var(--muted)]">
          Your order <strong className="text-[color:var(--ink)]">{placed.number}</strong> is confirmed for{" "}
          <strong className="text-[color:var(--ink)]">{money(placed.total, site.currency)}</strong>. A confirmation
          has been sent to {placed.email || "your email address"}.
        </p>
        <div className="card mt-8 p-5 text-left text-[13px] leading-relaxed text-[color:var(--muted)]">
          <p className="font-semibold text-[color:var(--ink)]">What happens next</p>
          <p className="mt-2">
            We will contact you to complete payment before the order ships. Nothing has been charged yet. When it is,
            the charge will read &ldquo;{site.billingDescriptor || site.brandName}&rdquo; on your statement.
          </p>
          <p className="mt-2">
            Ships from {site.shipsFrom}, {site.deliveryMinDays}&ndash;{site.deliveryMaxDays} business days.{" "}
            {site.returnWindowDays}-day returns. Questions? {site.supportEmail} or {site.supportPhone}.
          </p>
        </div>
        <a href={`/s/${site.slug}/shop`} className="btn mt-8">Continue shopping</a>
      </section>
    );
  }

  if (!lines.length) {
    return (
      <section className="wrap max-w-3xl py-16 text-center">
        <h1 className="text-[30px] font-extrabold tracking-tight">Your cart is empty</h1>
        <a href={`/s/${site.slug}/shop`} className="btn mt-8">Shop the line</a>
      </section>
    );
  }

  return (
    <section className="wrap grid max-w-5xl gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_360px]">
      <form onSubmit={placeOrder} className="space-y-8" aria-describedby="checkout-gateway-note">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Checkout</h1>
          <p className="mt-2 text-[13px] text-[color:var(--muted)]">
            Ships from {site.shipsFrom}. Delivery {site.deliveryMinDays}–{site.deliveryMaxDays} business days.
          </p>
        </div>

        <fieldset className="space-y-3">
          <legend className="eyebrow mb-2">Contact</legend>
          <input className={input} name="email" type="email" placeholder="Email address" autoComplete="email" required />
          <input className={input} name="phone" type="tel" placeholder="Phone number" autoComplete="tel" />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="eyebrow mb-2">Shipping address</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={input} name="firstName" placeholder="First name" autoComplete="given-name" required />
            <input className={input} name="lastName" placeholder="Last name" autoComplete="family-name" required />
          </div>
          <input className={input} name="address1" placeholder="Address" autoComplete="address-line1" required />
          <input className={input} name="address2" placeholder="Apartment, suite (optional)" autoComplete="address-line2" />
          <div className="grid gap-3 sm:grid-cols-3">
            <input className={input} name="city" placeholder="City" autoComplete="address-level2" required />
            <input className={input} name="state" placeholder="State" autoComplete="address-level1" required />
            <input className={input} name="zip" placeholder="ZIP code" autoComplete="postal-code" required />
          </div>
        </fieldset>

        <fieldset>
          <legend className="eyebrow mb-2">Payment</legend>
          {/* Emplacement passerelle. Tant que le MID n'est pas approuvé, aucun
              champ carte n'est affiché : on ne collecte pas un numéro qu'on ne
              peut pas traiter. */}
          <div
            id="checkout-gateway-note"
            className="rounded-xl border border-dashed border-[color:var(--line)] bg-[color:var(--sand)] p-5 text-[13px] leading-relaxed text-[color:var(--muted)]"
          >
            <p className="font-semibold text-[color:var(--ink)]">Pay on confirmation.</p>
            <p className="mt-2">
              Place your order now and we will reach out to complete payment before it ships. Card fields appear
              here once the merchant account is live; charges will show on your statement as &ldquo;
              {site.billingDescriptor || site.brandName}&rdquo;.
            </p>
          </div>
        </fieldset>

        {failed ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-700">{failed}</p>
        ) : null}

        <button type="submit" className="btn w-full" disabled={placing}>
          {placing ? "Placing order…" : "Place order"}
        </button>
      </form>

      <aside className="h-fit lg:sticky lg:top-24">
        <div className="card p-5">
          <h2 className="text-[15px] font-bold">Order summary</h2>
          <div className="mt-4 space-y-3">
            {lines.map((line) => (
              <div key={line.handle} className="flex items-center gap-3">
                {line.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={line.image} alt={line.name} className="h-12 w-12 rounded-lg object-cover" />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-[color:var(--wash)]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{line.name}</p>
                  <p className="text-[12px] text-[color:var(--muted)]">Qty {line.qty}</p>
                </div>
                <p className="text-[13px] font-semibold">{money(line.price * line.qty, site.currency)}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-2 border-t border-[color:var(--line)] pt-4 text-[13px]">
            <Row label="Subtotal" value={money(subtotal, site.currency)} />
            <Row label="Shipping" value={shipping === 0 ? "Free" : money(shipping, site.currency)} />
            <div className="border-t border-[color:var(--line)] pt-2">
              <Row label="Total" value={money(total, site.currency)} strong />
            </div>
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-[color:var(--muted)]">
            {site.returnWindowDays}-day returns. Questions? {site.supportEmail} or {site.supportPhone},{" "}
            {site.supportHours}.
          </p>
        </div>
      </aside>
    </section>
  );
}
