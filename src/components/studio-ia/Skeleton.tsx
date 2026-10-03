/**
 * Squelettes de chargement.
 *
 * Un spinner nu ne dit rien de ce qui arrive et donne l'impression que la page
 * est bloquee. Une silhouette de la mise en page finale se lit instantanement
 * et rend l'attente beaucoup plus courte a la perception.
 */

export function SkLine({ w = "100%", h = 11 }: { w?: string | number; h?: number }) {
  return <span className="skeleton block" style={{ width: w, height: h, borderRadius: 6 }} />;
}

/** Bandeau de tuiles statistiques. */
export function SkTiles({ n = 3 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="card px-4 py-3.5 flex flex-col gap-2.5">
          <SkLine w={72} h={9} />
          <SkLine w={110} h={22} />
          <SkLine w="60%" h={9} />
        </div>
      ))}
    </div>
  );
}

/** Grille de vignettes, au format des reels. */
export function SkGrid({ n = 10 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-2">
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className="skeleton sk-tile block" />
      ))}
    </div>
  );
}

/** Liste de lignes, pour Production et les listes de créateurs. */
export function SkRows({ n = 6 }: { n?: number }) {
  return (
    <div className="card overflow-hidden">
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="px-3 py-2.5 flex items-center gap-3"
          style={{ borderBottom: i < n - 1 ? "1px solid var(--border)" : "none" }}
        >
          <span className="skeleton shrink-0" style={{ width: 46, height: 58, borderRadius: 8 }} />
          <span className="flex-1 flex flex-col gap-1.5">
            <SkLine w="40%" h={11} />
            <SkLine w="70%" h={9} />
          </span>
          <SkLine w={90} h={24} />
        </div>
      ))}
    </div>
  );
}

/** Silhouette complète d'une page, affichée pendant la navigation. */
export function SkPage() {
  return (
    <div className="rise">
      <div className="flex flex-col gap-2 mb-5">
        <SkLine w={190} h={17} />
        <SkLine w={300} h={11} />
      </div>
      <SkTiles />
      <SkRows n={5} />
    </div>
  );
}
