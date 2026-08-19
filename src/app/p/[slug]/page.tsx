import { notFound } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import type { Metadata } from "next";
import { BankPageView } from "@/components/bank-pages/bank-page-view";
import { getBankPageBySlug } from "@/lib/bank-pages/store";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap" });

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getBankPageBySlug(slug);
  if (!page) return { title: "Page" };
  return {
    title: `${page.brandName} | Performance Marketing Agency`,
    description: page.heroSubtitle,
  };
}

export default async function PublicBankPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getBankPageBySlug(slug);
  if (!page) notFound();
  return (
    <div className={jakarta.className}>
      <BankPageView page={page} />
    </div>
  );
}
