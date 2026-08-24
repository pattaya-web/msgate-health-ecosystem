import { readFile, readdir } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Sert le cours AI UGC aspiré depuis Whop. Il est lu à la demande plutôt
 * qu'importé dans le bundle : 80 Ko de texte n'ont rien à faire dans le
 * JavaScript envoyé au navigateur à chaque visite de la page.
 */
const DIR = path.join(process.cwd(), "data", "ugc-course");

/** Titres lisibles : le nom de fichier vient d'un slug d'aspiration. */
const TITLES: Record<string, string> = {
  "_cours-complet.md": "Les 13 leçons du cours",
  "ugc-photorealistic-iphone-prompt-skill.txt": "Méthode de prompt photoréaliste",
  "ai-ugc-v3-seedance-2-0.txt": "Workflow Seedance 2.0",
  "ai-ugc-v3-kling-3-0.txt": "Workflow Kling 3.0",
  "how-to-generate-viral-tt-shop-videos.txt": "Vidéos TikTok Shop",
  "how-to-generate-viral-ai-animations.txt": "Animations IA",
  "how-to-make-hyper-realistic-ai-ugc-images-that-no-one-else-h.txt": "Images UGC hyperréalistes",
  "animation-claymation-example.txt": "Animation & claymation",
};

export async function GET(request: Request) {
  const file = new URL(request.url).searchParams.get("file");

  try {
    if (file) {
      // Un nom de fichier ne traverse jamais de dossier.
      const safe = path.basename(file);
      const text = await readFile(path.join(DIR, safe), "utf8");
      return NextResponse.json({ file: safe, title: TITLES[safe] ?? safe, text });
    }

    const files = await readdir(DIR);
    // Le cours complet en tête, le reste par titre.
    const docs = files
      .filter((name) => name.endsWith(".md") || name.endsWith(".txt"))
      .map((name) => ({ file: name, title: TITLES[name] ?? name }))
      .sort((a, b) =>
        a.file === "_cours-complet.md" ? -1 : b.file === "_cours-complet.md" ? 1 : a.title.localeCompare(b.title)
      );

    return NextResponse.json({ docs });
  } catch {
    return NextResponse.json({ docs: [], error: "Cours introuvable dans data/ugc-course" });
  }
}
