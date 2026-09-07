import { Plus_Jakarta_Sans } from "next/font/google";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap" });

export default function EcomSiteLayout({ children }: { children: React.ReactNode }) {
  return <div className={jakarta.className}>{children}</div>;
}
