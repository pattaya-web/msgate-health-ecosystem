export type StaticCreative = {
  id: string;
  createdAt: string;
  brief: string;
  prompt: string;
  ratio: "1:1" | "9:16" | "3:4";
  resolution: "1K" | "2K";
  resultFiles: string[];
  refFiles: string[];
};

export const STUDIO_REUSE_KEY = "msgate.studio.reuse";
