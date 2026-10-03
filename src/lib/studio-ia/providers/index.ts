import type { ProviderId } from "../types";
import { flashOmni } from "./flash-omni";
import { genjutsu } from "./genjutsu";
import { kling } from "./kling";
import { klingMotion } from "./kling-motion";
import { klingMotion26 } from "./kling-motion-26";
import { seedance, seedance25 } from "./seedance";
import type { VideoProvider } from "./types";
import { wan } from "./wan";
import { wanAnimate } from "./wan-animate";

const REGISTRY: Record<ProviderId, VideoProvider> = { wan, wanAnimate, kling, klingMotion, klingMotion26, seedance, seedance25, flashOmni, genjutsu };

export function getProvider(id: ProviderId): VideoProvider {
  return REGISTRY[id];
}

export type { PollResult, StartResult, VideoProvider } from "./types";
