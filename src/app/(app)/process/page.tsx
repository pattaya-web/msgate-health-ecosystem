"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/shared/page-states";

/** Ouvre directement le whiteboard IBO · MID · BANK · SHOP */
export default function ProcessIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/process/process-ecosystem-master");
  }, [router]);
  return <LoadingState className="min-h-[420px]" />;
}
