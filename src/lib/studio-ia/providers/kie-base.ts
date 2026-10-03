import { createTask, getTask } from "@/lib/kie";
import type { ProviderConfig } from "../config";
import type { ProviderInput } from "../types";
import type { PollResult, StartResult, VideoProvider } from "./types";

/**
 * Socle des providers hébergés par KIE : même enveloppe createTask /
 * recordInfo pour tous, seul le `payload` change.
 */
export function kieProvider(
  config: ProviderConfig,
  buildPayload: (input: ProviderInput) => Record<string, unknown>,
): VideoProvider {
  return {
    config,
    buildPayload,
    async generateVideoTransformation(input, callbackUrl) {
      const payload = buildPayload(input);
      const providerJobId = await createTask(config.kieModel, payload, callbackUrl);
      return { providerJobId, payload };
    },
    async poll(providerJobId): Promise<PollResult> {
      const rec = await getTask(providerJobId);
      const state =
        rec.state === "success" ? "success"
        : rec.state === "fail" ? "fail"
        : rec.state === "generating" ? "generating"
        : "waiting";
      return {
        state,
        progress: rec.progress,
        resultUrl: rec.resultUrls[0] ?? "",
        error: rec.failMsg,
        creditsConsumed: rec.creditsConsumed,
      };
    },
  };
}
