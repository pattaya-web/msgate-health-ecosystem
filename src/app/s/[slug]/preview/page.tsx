"use client";

/**
 * La boutique rendue depuis le brouillon de l'éditeur, pas depuis le disque.
 *
 * Elle vit dans une iframe pour une raison décisive : les points de rupture CSS
 * se calculent sur la fenêtre. Réduire un conteneur avec `transform` ou `zoom`
 * afficherait la version ordinateur à 390 px de large. Une iframe a sa propre
 * fenêtre, donc l'aperçu téléphone est le vrai rendu téléphone.
 *
 * Elle sert aussi de surface de travail, et de boutique, en même temps : on s'y
 * promène comme un client — le catalogue, une fiche, le panier — et on retouche
 * ce qu'on voit là où on le voit. Il n'y a pas de bascule entre les deux, parce
 * qu'on ne veut pas avoir à déclarer son intention avant chaque geste.
 *
 * Ce qui départage un clic, c'est ce qu'on a sous le curseur :
 *
 *   1. un lien           → on le suit, sans quitter le cadre ;
 *   2. une vraie commande → elle fait son travail (ajouter au panier, un champ
 *      qui prend le focus), sinon la boutique ne s'essaie pas ;
 *   3. une image         → elle s'ouvre en retouche ;
 *   4. le reste          → on désigne la section, et l'éditeur ouvre ses réglages.
 *
 * Reste le cas qui a imposé cette liste : la carte produit, un lien QUI
 * ENVELOPPE une image. Le lien gagne — c'est ce qu'on attend en cliquant une
 * carte — et la retouche de cette image-là passe par le crayon qui apparaît
 * dans son coin au survol.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CartView, CheckoutView } from "@/components/ecom-sites/cart";
import {
  AboutView,
  ContactView,
  CustomPageView,
  HomeView,
  PolicyView,
  ProductView,
  ShopView,
  Storefront,
} from "@/components/ecom-sites/storefront";
import { buildPolicy, POLICY_SLUGS, type PolicySlug } from "@/lib/ecom-sites/policies";
import { BLOCK_LABELS, sectionsOf } from "@/lib/ecom-sites/sections";
import type { EcomSite } from "@/lib/ecom-sites/types";

/** Les éléments qui doivent se comporter comme sur le site, pas comme une cible. */
const CONTROLS = "button, input, select, textarea, label, [role='button']";

/** Le crayon posé sur une image dont le clic est déjà pris par un lien. */
type Badge = { top: number; left: number; key: string; src: string };

/**
 * L'élément de texte sous le curseur : le plus proche qui porte lui-même des
 * mots (pas seulement des enfants). On s'arrête à la section : elle n'a pas de
 * texte propre, et au-delà on quitterait le bloc cliqué.
 */
function textElementAt(target: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = target;
  while (el && el !== document.body) {
    if (el.dataset.sectionId !== undefined) return null;
    const ownText = Array.from(el.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? "").trim());
    if (ownText) return el;
    el = el.parentElement;
  }
  return null;
}

export default function PreviewPage() {
  const [site, setSite] = useState<EcomSite | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Le chemin courant, relatif à la boutique : « / », « /shop?cat=x »… */
  const [path, setPath] = useState("/");
  const [badge, setBadge] = useState<Badge | null>(null);
  /**
   * Après une correction de texte, la boutique se remonte de zéro.
   *
   * Taper dans la page modifie le DOM sous React ; quand le brouillon corrigé
   * revient, on repart d'un rendu propre plutôt que de laisser React raccommoder
   * des nœuds qu'il ne reconnaît plus.
   */
  const [version, setVersion] = useState(0);
  const remountRef = useRef(false);
  /** La croix posée sur le texte survolé, et le texte qu'elle retirerait. */
  const [removeBadge, setRemoveBadge] = useState<{ top: number; left: number } | null>(null);
  const removeRef = useRef<HTMLElement | null>(null);

  /**
   * Changer de page.
   *
   * Le crayon se retire ici, et pas dans un effet sur le chemin : il désigne une
   * image précise, à un endroit précis de l'écran. Le laisser survivre à la
   * navigation le ferait flotter au-dessus de la page suivante, pointant une
   * image qui n'y est plus.
   */
  const go = useCallback((next: string) => {
    setPath(next);
    setBadge(null);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Même origine seulement : l'aperçu ne rend que ce que l'outil envoie.
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        site?: EcomSite;
        id?: string | null;
        path?: string;
        ok?: boolean;
      };
      if (data?.type === "msgate:preview" && data.site) {
        setSite(data.site);
        if (remountRef.current) {
          remountRef.current = false;
          setVersion((value) => value + 1);
        }
      }
      if (data?.type === "msgate:selected") setSelected(data.id ?? null);
      if (data?.type === "msgate:navigate" && typeof data.path === "string") go(data.path);
      // Une correction refusée (texte du gabarit) : la page reprend son texte.
      if (data?.type === "msgate:text-result" && data.ok === false) {
        remountRef.current = false;
        setVersion((value) => value + 1);
      }
      // L'éditeur veut le texte de la page ouverte, pour le presse-papiers.
      if (data?.type === "msgate:copy-request") {
        const text = (document.querySelector(".shopfront") as HTMLElement | null)?.innerText ?? "";
        window.parent?.postMessage({ type: "msgate:copy", text }, window.location.origin);
      }
    }
    window.addEventListener("message", onMessage);
    // L'éditeur peut avoir envoyé son brouillon avant que l'écoute soit posée.
    window.parent?.postMessage({ type: "msgate:preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [go]);

  /* L'éditeur affiche le chemin courant : il doit savoir où on en est. */
  useEffect(() => {
    window.parent?.postMessage({ type: "msgate:path", path }, window.location.origin);
    // Une nouvelle page se lit depuis le haut, comme dans un vrai navigateur.
    window.scrollTo({ top: 0 });
  }, [path]);

  /* Le clic, arbitré selon ce qu'on a sous le curseur — voir l'en-tête. */
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;

      // La croix d'un texte : on retire l'élément qu'elle désigne.
      if (target?.closest?.("[data-text-remove]")) {
        event.preventDefault();
        event.stopPropagation();
        const el = removeRef.current;
        if (el) {
          remountRef.current = true;
          window.parent?.postMessage({ type: "msgate:text", from: el.innerText, to: "" }, window.location.origin);
        }
        setRemoveBadge(null);
        return;
      }

      // Le crayon d'abord : il est posé PAR-DESSUS l'image qu'il retouche.
      if (target?.closest?.("[data-edit-badge]")) {
        event.preventDefault();
        event.stopPropagation();
        if (badge) send(badge.key, badge.src);
        return;
      }

      // Un lien se suit ; avec Alt enfoncé, on corrige son texte au lieu de le suivre.
      const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (link && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        follow(link);
        return;
      }

      /*
       * Une vraie commande fait son travail.
       *
       * Tout intercepter en capture empêche de poser le curseur dans un champ et
       * coupe les gestionnaires de React : « ajouter au panier » et le formulaire
       * de commande deviennent inertes. Or se promener dans sa boutique, c'est
       * aussi l'essayer.
       */
      // Un accordéon s'ouvre au clic ; son titre se corrige avec Alt enfoncé.
      if (target?.closest?.("summary") && !event.altKey) return;
      if (target?.closest?.(CONTROLS)) return;

      event.preventDefault();
      event.stopPropagation();

      /*
       * On cherche l'image SOUS le curseur, pas seulement dans les parents.
       *
       * La bannière est posée en fond, derrière le bloc de titre : remonter les
       * ancêtres du point cliqué ne la trouvait jamais, et cliquer dessus
       * sélectionnait la section au lieu d'ouvrir sa retouche.
       */
      /*
       * Un texte posé sur une image — le titre du hero sur sa bannière — se
       * corrige comme texte : l'image derrière ne prend le clic que si on
       * clique à côté des mots.
       */
      const textEl = textElementAt(target);
      const stack = document.elementsFromPoint(event.clientX, event.clientY) as HTMLElement[];
      const image =
        (target?.closest?.("[data-image-key]") as HTMLElement | null) ??
        (textEl ? null : stack.find((el) => el.dataset?.imageKey)) ??
        null;
      if (image?.dataset.imageKey) {
        send(image.dataset.imageKey, (image as HTMLImageElement).src ?? "");
        return;
      }

      // Un texte : il se corrige sur place, là où on le lit.
      if (textEl) startEdit(textEl, event.clientX, event.clientY);

      const section = target?.closest?.("[data-section-id]") as HTMLElement | null;
      window.parent?.postMessage(
        { type: "msgate:select", id: section?.dataset.sectionId ?? null },
        window.location.origin
      );
    }

    function send(key: string, src: string) {
      window.parent?.postMessage({ type: "msgate:image", key, src }, window.location.origin);
    }

    /**
     * Un texte qu'on retape dans la page.
     *
     * L'élément devient éditable le temps de la frappe, le curseur posé là où on
     * a cliqué. Entrée valide, Échap annule, le collage arrive en texte brut. À
     * la sortie, l'éditeur reçoit « ce texte → celui-là » et décide où l'écrire ;
     * la boutique se remonte ensuite depuis le brouillon corrigé.
     */
    function startEdit(el: HTMLElement, x: number, y: number) {
      if (el.isContentEditable) return;
      const original = el.innerText;
      let cancelled = false;
      el.contentEditable = "true";
      el.spellcheck = false;
      el.dataset.textEditing = "true";
      delete el.dataset.textHover;
      el.focus();
      const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
      const range = doc.caretRangeFromPoint?.(x, y);
      if (range) {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      const onKey = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          cancelled = true;
          keyEvent.preventDefault();
          el.blur();
        } else if (keyEvent.key === "Enter" && !keyEvent.shiftKey) {
          keyEvent.preventDefault();
          el.blur();
        }
      };
      const onPaste = (pasteEvent: ClipboardEvent) => {
        pasteEvent.preventDefault();
        document.execCommand("insertText", false, pasteEvent.clipboardData?.getData("text/plain") ?? "");
      };
      const finish = () => {
        el.removeEventListener("keydown", onKey);
        el.removeEventListener("paste", onPaste);
        const next = el.innerText;
        el.removeAttribute("contenteditable");
        delete el.dataset.textEditing;
        if (cancelled || next.trim() === original.trim()) {
          el.innerText = original;
          setVersion((value) => value + 1);
          return;
        }
        // Un texte vidé est retiré de la page, pas seulement effacé.
        remountRef.current = true;
        window.parent?.postMessage({ type: "msgate:text", from: original, to: next.trim() ? next : "" }, window.location.origin);
      };
      el.addEventListener("keydown", onKey);
      el.addEventListener("paste", onPaste);
      el.addEventListener("blur", finish, { once: true });
    }

    /**
     * Un lien suivi sans quitter le cadre.
     *
     * Les liens de la boutique sont absolus — « /s/sagerenew/shop » — parce que
     * le site public les sert ainsi. On en retire la racine pour retrouver le
     * chemin interne. Ce qui pointe ailleurs (un Instagram, un mailto) part dans
     * un onglet : le charger ici remplacerait l'aperçu par un site étranger.
     */
    function follow(link: HTMLAnchorElement) {
      const href = link.getAttribute("href") || "";
      if (!href || href === "#") return;

      if (/^(mailto:|tel:)/i.test(href)) {
        window.open(href, "_blank", "noopener");
        return;
      }

      const url = new URL(href, window.location.href);
      const root = `/s/${site?.slug ?? ""}`;
      if (url.origin !== window.location.origin || !url.pathname.startsWith(root)) {
        window.open(url.href, "_blank", "noopener");
        return;
      }
      go(`${url.pathname.slice(root.length) || "/"}${url.search}`);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [site?.slug, badge, go]);

  /*
   * Le crayon, sur les images dont le clic appartient à un lien.
   *
   * Une carte produit s'ouvre au clic, c'est ce qu'on attend d'elle ; sa photo
   * resterait donc impossible à retoucher depuis la page où on la voit. Le
   * crayon rend ce geste à l'image sans le disputer au lien.
   */
  useEffect(() => {
    function onOver(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-edit-badge]")) return;

      // La croix elle-même : on la laisse en place le temps de cliquer.
      if (target?.closest?.("[data-text-remove]")) return;

      // Le texte sous le curseur se signale : il se corrige d'un clic, sa croix le retire.
      for (const el of document.querySelectorAll<HTMLElement>("[data-text-hover]")) delete el.dataset.textHover;
      let hovered: HTMLElement | null = null;
      if (!target?.closest?.(CONTROLS) && !target?.closest?.("a[href]")) {
        const textEl = textElementAt(target);
        if (textEl && !textEl.dataset.textEditing) {
          textEl.dataset.textHover = "true";
          hovered = textEl;
        }
      }
      removeRef.current = hovered;
      if (hovered) {
        const box = hovered.getBoundingClientRect();
        setRemoveBadge({ top: box.top + window.scrollY - 10, left: box.right + window.scrollX - 8 });
      } else {
        setRemoveBadge(null);
      }

      const image = target?.closest?.("[data-image-key]") as HTMLElement | null;
      if (!image?.dataset.imageKey || !image.closest("a[href]")) {
        setBadge(null);
        return;
      }

      const box = image.getBoundingClientRect();
      setBadge({
        top: box.top + window.scrollY + 8,
        left: box.right + window.scrollX - 36,
        key: image.dataset.imageKey,
        src: (image as HTMLImageElement).src ?? "",
      });
    }

    document.addEventListener("mouseover", onOver);
    const onScroll = () => {
      setBadge(null);
      setRemoveBadge(null);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mouseover", onOver);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  /*
   * Réordonner la page en attrapant une section dans l'aperçu.
   *
   * La liste de gauche savait déjà le faire, mais elle demande de retrouver
   * une ligne par son nom pour déplacer un bloc qu'on a sous les yeux. Ici on
   * saisit la section elle-même : un trait bleu montre où elle tombera, et
   * l'éditeur reçoit le déplacement — c'est lui qui détient l'ordre, l'aperçu
   * ne fait que le désigner.
   */
  useEffect(() => {
    let dragged: string | null = null;

    const sectionOf = (target: EventTarget | null) =>
      ((target as HTMLElement | null)?.closest?.("[data-section-id]") as HTMLElement | null) ?? null;

    const clearMarks = () => {
      for (const el of document.querySelectorAll<HTMLElement>("[data-drop]")) delete el.dataset.drop;
    };

    function onDragStart(event: DragEvent) {
      const el = sectionOf(event.target);
      if (!el?.dataset.sectionId) return;
      dragged = el.dataset.sectionId;
      el.dataset.dragging = "true";
      event.dataTransfer?.setData("text/plain", dragged);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    }

    function onDragOver(event: DragEvent) {
      if (!dragged) return;
      // Sans ce refus du comportement par défaut, aucun dépôt n'est accepté.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearMarks();
      const el = sectionOf(event.target);
      if (!el?.dataset.sectionId || el.dataset.sectionId === dragged) return;
      /* Moitié haute, la section se pose avant ; moitié basse, après. */
      const box = el.getBoundingClientRect();
      el.dataset.drop = event.clientY < box.top + box.height / 2 ? "before" : "after";
    }

    function onDrop(event: DragEvent) {
      if (!dragged) return;
      event.preventDefault();
      const el = sectionOf(event.target);
      const place = el?.dataset.drop;
      if (el?.dataset.sectionId && place) {
        window.parent?.postMessage(
          { type: "msgate:reorder", id: dragged, over: el.dataset.sectionId, place },
          window.location.origin
        );
      }
      onDragEnd();
    }

    function onDragEnd() {
      for (const el of document.querySelectorAll<HTMLElement>("[data-dragging]")) delete el.dataset.dragging;
      clearMarks();
      dragged = null;
    }

    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    document.addEventListener("dragend", onDragEnd);
    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("dragend", onDragEnd);
    };
  }, []);

  if (!site) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "#94a3b8", fontSize: 13 }}>
        Aperçu en attente…
      </div>
    );
  }

  return (
    <>
      <style>{`
        /* Le repérage des sections, façon éditeur de thème. */
        [data-section-id] { position: relative; cursor: grab; }
        [data-section-id][data-dragging="true"] { opacity: .4; cursor: grabbing; }
        /* Le trait de dépôt : où la section attrapée va tomber. */
        [data-section-id][data-drop="before"] { box-shadow: inset 0 5px 0 rgb(37,99,235); }
        [data-section-id][data-drop="after"] { box-shadow: inset 0 -5px 0 rgb(37,99,235); }
        [data-section-id]::after {
          content: ""; position: absolute; inset: 0; pointer-events: none;
          border: 2px solid transparent; border-radius: 10px;
          transition: border-color .12s ease, background-color .12s ease;
        }
        [data-section-id]:hover::after { border-color: rgba(59,130,246,.55); background: rgba(59,130,246,.05); }
        /* Les images se signalent à part : elles se retouchent d'un clic. */
        [data-image-key] { outline-offset: -3px; transition: outline-color .12s ease; outline: 3px solid transparent; }
        [data-image-key]:hover { outline-color: rgb(16,185,129); }
        /* Une image libre se retouche au clic ; sous un lien, le lien l'emporte
           et c'est le crayon qui retouche — le curseur annonce lequel. */
        [data-image-key]:not(a [data-image-key]) { cursor: zoom-in; }
        a [data-image-key], a[data-image-key] { cursor: pointer; }
        [data-section-id][data-selected="true"]::after {
          border-color: rgb(37,99,235); background: rgba(59,130,246,.07);
        }
        /* Une étiquette dit ce qu'on s'apprête à régler. */
        [data-section-id]:hover::before, [data-section-id][data-selected="true"]::before {
          content: attr(data-section-label) " · glisser pour déplacer";
          position: absolute; top: 0; left: 0; z-index: 30;
          background: rgb(37,99,235); color: #fff;
          font: 600 11px/1 ui-sans-serif, system-ui, sans-serif;
          padding: 5px 8px; border-radius: 0 0 8px 0; pointer-events: none;
        }
        /* Les liens s'annoncent comme des liens : on peut s'y promener. */
        a { cursor: pointer; }
        /* Un texte se corrige sur place : il se signale au survol, se cerne pendant la frappe. */
        [data-text-hover="true"] { outline: 1px dashed rgba(16,185,129,.85); outline-offset: 2px; border-radius: 3px; cursor: text; }
        [data-text-editing="true"] { outline: 2px solid rgb(16,185,129) !important; outline-offset: 2px; border-radius: 3px; background: rgba(16,185,129,.06); cursor: text; }
      `}</style>
      <SelectionMarker site={site} selected={selected} />
      <Storefront key={version} site={site}>
        <PathView site={site} path={path} />
      </Storefront>
      {removeBadge ? (
        <button
          type="button"
          data-text-remove=""
          title="Retirer ce texte de la page"
          style={{
            position: "absolute",
            top: removeBadge.top,
            left: removeBadge.left,
            zIndex: 40,
            width: 20,
            height: 20,
            display: "grid",
            placeItems: "center",
            borderRadius: 999,
            border: 0,
            background: "rgb(225,29,72)",
            color: "#fff",
            fontSize: 12,
            lineHeight: 1,
            cursor: "pointer",
            boxShadow: "0 2px 6px rgba(0,0,0,.25)",
          }}
        >
          ×
        </button>
      ) : null}
      {badge ? (
        <button
          type="button"
          data-edit-badge=""
          title="Retoucher cette image"
          style={{
            position: "absolute",
            top: badge.top,
            left: badge.left,
            zIndex: 40,
            width: 28,
            height: 28,
            display: "grid",
            placeItems: "center",
            borderRadius: 8,
            border: 0,
            background: "rgb(16,185,129)",
            color: "#fff",
            fontSize: 14,
            lineHeight: 1,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,.25)",
          }}
        >
          ✎
        </button>
      ) : null}
    </>
  );
}

function isPolicy(value: string): value is PolicySlug {
  return (POLICY_SLUGS as readonly string[]).includes(value);
}

/**
 * La page correspondant au chemin, choisie comme le fait le vrai site.
 *
 * Le routage public répartit ces vues sur des fichiers — `/shop`, `/product`,
 * `[page]`. L'aperçu n'a pas de routeur : il tient le chemin en mémoire, donc
 * il refait ici le même aiguillage, sur les mêmes composants. C'est la
 * condition pour que ce qu'on regarde soit vraiment ce qui sera servi.
 */
function PathView({ site, path }: { site: EcomSite; path: string }) {
  const [pathname, query] = path.split("?");
  const parts = pathname.split("/").filter(Boolean);

  if (!parts.length) return <HomeView site={site} />;

  if (parts[0] === "shop") {
    const cat = new URLSearchParams(query || "").get("cat") || undefined;
    return <ShopView site={site} category={cat} />;
  }

  if (parts[0] === "product" && parts[1]) {
    const product = site.products.find((item) => item.handle === parts[1]);
    return product ? <ProductView site={site} product={product} /> : <Missing label={parts[1]} />;
  }

  if (parts[0] === "about") return <AboutView site={site} />;
  if (parts[0] === "contact") return <ContactView site={site} />;
  if (parts[0] === "cart") return <CartView site={site} />;
  if (parts[0] === "checkout") return <CheckoutView site={site} />;
  if (isPolicy(parts[0])) return <PolicyView site={site} doc={buildPolicy(site, parts[0])} />;

  const custom = (site.pages ?? []).find((entry) => entry.slug === parts[0]);
  if (custom) return <CustomPageView site={site} page={custom} />;

  return <Missing label={pathname} />;
}

/** Un lien qui ne mène à rien se dit, plutôt que de rendre une page vide. */
function Missing({ label }: { label: string }) {
  return (
    <section className="wrap py-20">
      <p className="eyebrow">404</p>
      <h1 className="mt-2 text-[28px] font-extrabold tracking-tight">Rien à cette adresse</h1>
      <p className="mt-3 text-[14px] text-[color:var(--muted)]">
        Le lien pointe vers « {label} », qui n&apos;existe pas sur cette boutique.
      </p>
    </section>
  );
}

/**
 * Pose l'état de sélection et l'étiquette sur les sections déjà rendues.
 *
 * Passer ces informations dans les composants de la boutique reviendrait à y
 * faire entrer la notion d'éditeur, qui n'a rien à y faire : ce sont les mêmes
 * composants qui servent le site public. On les applique après coup, ici, où
 * cela ne concerne que l'aperçu.
 */
function SelectionMarker({ site, selected }: { site: EcomSite; selected: string | null }) {
  useEffect(() => {
    // Le libellé vient de la vraie liste, pas d'une déduction sur l'identifiant.
    const byId = new Map(sectionsOf(site).map((entry) => [entry.id, BLOCK_LABELS[entry.block]]));
    for (const el of document.querySelectorAll<HTMLElement>("[data-section-id]")) {
      const id = el.dataset.sectionId ?? "";
      el.dataset.selected = String(id === selected);
      el.dataset.sectionLabel = byId.get(id) ?? "Section";
      // Saisissable ici plutôt que dans la boutique : le site public ne se déplace pas.
      el.draggable = true;
    }
  });
  return null;
}
