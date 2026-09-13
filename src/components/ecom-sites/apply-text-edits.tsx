"use client";

import { useLayoutEffect } from "react";

/**
 * Les corrections de texte qui ne vivent dans aucun champ, appliquées à la page.
 *
 * Les champs du site, les politiques, la réassurance et le pied de page sont
 * corrigés avant le rendu. Restent les mots du gabarit — « Add to cart »,
 * « Last updated », les libellés du menu — écrits en dur dans la boutique. On
 * les corrige ici, dans la page rendue : chaque texte dont le contenu est
 * exactement un texte d'origine reçoit sa correction. Cela vaut pour l'aperçu
 * comme pour le site public, une fois la page chargée.
 */
export function ApplyTextEdits({ edits }: { edits?: Record<string, string> }) {
  useLayoutEffect(() => {
    if (!edits || !Object.keys(edits).length) return;
    const root = document.querySelector(".shopfront");
    if (!root) return;
    const normalize = (value: string) => value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const table = new Map(Object.entries(edits).map(([from, to]) => [normalize(from), to]));

    const walk = (el: Element) => {
      // Un texte en cours de frappe n'est pas touché.
      if ((el as HTMLElement).dataset?.textEditing) return;
      const own = normalize(el.textContent ?? "");
      if (own && table.has(own) && !el.matches("script, style")) {
        const to = table.get(own) ?? "";
        if (normalize(el.textContent ?? "") !== normalize(to)) el.textContent = to;
        return;
      }
      for (const child of Array.from(el.children)) walk(child);
      // Les bouts de texte à côté d'autres éléments (« Email », « or call »…).
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const value = normalize(node.nodeValue ?? "");
        if (value && table.has(value)) node.nodeValue = ` ${table.get(value) ?? ""} `;
      }
    };
    walk(root);
  });
  return null;
}
