/**
 * Les photos des boutiques sont des PNG de ~2 Mo (rendus Kie recopiés dans
 * data/media) : plusieurs secondes chacune depuis le VPS. On sert à la place
 * leur version JPEG réduite (/api/media/<id>?poster=1&w=…, ~150 Ko, générée
 * une fois puis gardée sur le disque). Les autres adresses restent telles quelles.
 */
export function fastImage<T extends string | undefined | null>(src: T, width: 800 | 1200 = 1200): T {
  if (!src) return src;
  const match = /^((?:https?:\/\/[^/]+)?\/api\/media\/[A-Za-z0-9]+\.(?:png|jpe?g|webp))$/i.exec(src);
  return (match ? `${match[1]}?poster=1&w=${width}` : src) as T;
}
