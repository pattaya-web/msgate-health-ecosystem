import { PROVIDERS } from "../config";
import { kieProvider } from "./kie-base";

/**
 * Wan 2.2 Animate — mode « replace » (docs.kie.ai/market/wan/2-2-animate-replace).
 *
 * Schéma vérifié dans .cache/kie-docs/wan_2-2-animate-replace.md : video_url
 * (mp4/mov/mkv, 10 Mo max), image_url (jpg/png/webp), resolution
 * (480p | 580p | 720p). Pas de prompt : la photo fait tout.
 *
 * C'est le modèle du « remplacement de personnage » : la personne de la photo
 * prend la place du sujet dans la vidéo, avec le décor, l'éclairage, les
 * objets tenus et le texte incrusté conservés. Le rendu du reel de référence
 * (homme → femme, même salle de bain, même produit) correspond à ce mode.
 *
 * La limite de 10 Mo est gérée en amont : la vidéo source est recompressée
 * en 720p avant l'envoi (voir video-transform).
 */
export const wanAnimate = kieProvider(PROVIDERS.wanAnimate, (i) => ({
  video_url: i.sourceVideoUrl,
  image_url: i.referenceImageUrl,
  // 1080p n'existe pas sur ce modèle : 720p est son maximum.
  resolution: "720p",
  nsfw_checker: false,
}));
