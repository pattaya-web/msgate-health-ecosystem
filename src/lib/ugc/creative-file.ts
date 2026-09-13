/**
 * Ce qu'on fait d'une créa déposée, avant de l'envoyer.
 *
 * Deux studios reprennent une créative existante — celui qui la copie pour
 * notre produit, celui qui la décline telle quelle. Tous deux lisent le fichier
 * en base64 et mesurent son format, et ces deux gestes n'ont rien à voir avec
 * l'un ou l'autre : ils appartiennent au fichier.
 */

export function toDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture de l'image impossible"));
    reader.readAsDataURL(file);
  });
}

/** Formats acceptés par le modèle, avec leur valeur numérique. */
export const RATIOS: Array<[string, number]> = [
  ["9:16", 9 / 16],
  ["3:4", 3 / 4],
  ["1:1", 1],
  ["4:3", 4 / 3],
  ["16:9", 16 / 9],
];

/**
 * Format de la créa source, mesuré sur l'image déposée.
 *
 * Sans lui la sortie partait toujours en 9:16 : une story reprise depuis un
 * carré perdait son cadrage. On retient le format accepté le plus proche.
 */
export function measureAspect(file: File): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const value = image.naturalWidth / image.naturalHeight;
      const best = RATIOS.reduce((closest, entry) =>
        Math.abs(entry[1] - value) < Math.abs(closest[1] - value) ? entry : closest
      );
      resolve(best[0]);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve("9:16");
    };
    image.src = url;
  });
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
