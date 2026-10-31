/**
 * Le dessin commun des icônes de l'appli (onglet, écran d'accueil iPhone,
 * manifest) : le carré d'encre de la marque et son tracé « Activity » de
 * lucide-react, en blanc cassé. Le tracé tient dans la zone sûre (≈ 50 % du
 * carré) pour survivre au masque rond d'Android comme aux coins d'iOS.
 */
export const BRAND_INK = "#233137";
export const BRAND_PAPER = "#f9fbfb";

const ACTIVITY_PATH =
  "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2";

export function AppIconArt({ size, radius = 0 }: { size: number; radius?: number }) {
  const glyph = Math.round(size * 0.5);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(145deg, #2d3f46 0%, ${BRAND_INK} 55%, #182327 100%)`,
        borderRadius: radius,
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke={BRAND_PAPER} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
        <path d={ACTIVITY_PATH} />
      </svg>
    </div>
  );
}
