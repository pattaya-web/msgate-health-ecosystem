import type { Ratio } from "@/lib/studio/ratios";

export type StaticCreative = {
  id: string;
  createdAt: string;
  brief: string;
  prompt: string;
  ratio: Ratio;
  resolution: "1K" | "2K";
  resultFiles: string[];
  refFiles: string[];
};

export const STUDIO_REUSE_KEY = "msgate.studio.reuse";
