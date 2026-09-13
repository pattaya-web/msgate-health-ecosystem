import { PageSkeleton } from "@/components/shared/page-states";

/** Retour visuel immédiat pendant que Next prépare le segment demandé. */
export default function Loading() {
  return <PageSkeleton />;
}
