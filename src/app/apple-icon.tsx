import { ImageResponse } from "next/og";
import { AppIconArt } from "@/components/layout/app-icon-art";

/** Icône « Sur l'écran d'accueil » de l'iPhone : carré plein, iOS arrondit lui-même les coins. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<AppIconArt size={size.width} />, { ...size });
}
