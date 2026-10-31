import { ImageResponse } from "next/og";
import { AppIconArt } from "@/components/layout/app-icon-art";

/** Icône de l'onglet et du manifest (Android, Chrome) : carré plein, coins arrondis légers. */
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<AppIconArt size={size.width} />, { ...size });
}
