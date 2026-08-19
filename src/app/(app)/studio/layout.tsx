import { TikTok_Sans } from "next/font/google";
import { StudioTabs } from "@/components/studio/studio-tabs";

const tiktok = TikTok_Sans({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-tiktok",
});

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${tiktok.variable} space-y-3`}>
      <span className={`${tiktok.className} sr-only`}>TikTok Sans</span>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Creatives</h1>
          <p className="text-[12px] text-slate-500">Static · basic · toutes les créas · remove · texte / montage vidéo</p>
        </div>
        <StudioTabs />
      </div>
      {children}
    </div>
  );
}
