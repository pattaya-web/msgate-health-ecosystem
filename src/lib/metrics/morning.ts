import { buildPipeline } from "@/lib/creative-pipeline/build";
import { readStore } from "@/lib/creative-pipeline/store";
import { buildObjectivesBar } from "@/lib/metrics/objectives";
import { buildScalingRamp, type RampRow } from "@/lib/metrics/scaling-ramp";
import { buildPilotage } from "@/lib/pilotage/build";
import { reportToday } from "@/lib/report-tz";

/**
 * L'onglet « Matin » de l'Ads Manager : ce qu'il faut faire aujourd'hui, sur
 * un écran. Le ROAS réel et le bénéfice réel des 3 derniers jours complets,
 * l'approbation Reign sur 7 jours, l'état des hausses ; les actions de la
 * rampe qui ont un bouton ; les créas que le pipeline, en lecture 3 j
 * (quotidienne), dit de couper (coupes d'urgence : jamais de passage en MAIN
 * sur 3 j, ça se décide dans la vue 7 j) ; et le rappel du jeudi ou du
 * dimanche.
 */

export type MorningCreative = {
  key: string;
  name: string;
  adsetName: string;
  accountId: string;
  postId: string | null;
  action: "Couper";
  badge: string;
  sales: number;
  liveAdIds: string[];
  /** Le verdict en clair et la phrase de justification. */
  label: string;
  why: string;
};

export type Morning = {
  realRoas3: number | null;
  profit3: number | null;
  approval7: number | null;
  open: boolean;
  breakeven: number | null;
  rampActions: RampRow[];
  creatives: MorningCreative[];
  note: string | null;
  builtAt: string;
};

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function buildMorning(options: { aggressive: boolean }): Promise<Morning> {
  const today = reportToday();
  const [ramp, pipeline, last3, pilotage, store] = await Promise.all([
    buildScalingRamp(options),
    buildPipeline(3),
    buildObjectivesBar(addDays(today, -3), addDays(today, -1)).catch(() => null),
    buildPilotage().catch(() => null),
    readStore(),
  ]);

  const creatives: MorningCreative[] = [];
  for (const row of pipeline.creatives) {
    for (const place of row.placements) {
      if (!place.live) continue;
      if (place.todo !== "Couper") continue;
      const m = place.margins[7];
      creatives.push({
        key: `${row.key}|${place.adsetId}`,
        name: row.name,
        adsetName: place.adsetName,
        accountId: row.accountId,
        postId: row.postId,
        action: "Couper",
        badge: m.badge,
        sales: m.sales,
        liveAdIds: place.liveAdIds,
        label: place.label,
        why: place.why,
      });
    }
  }

  // Le rappel du jeudi (mercredi soir déjà) et du dimanche.
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const ready = store.briefs.filter((brief) => brief.status === "PRÊTE").length;
  const note =
    weekday === 3 || weekday === 4
      ? `${ready} brief${ready > 1 ? "s" : ""} prêt${ready > 1 ? "s" : ""} pour jeudi`
      : weekday === 0
        ? "KPI du dimanche à remplir (onglet Ads Manager → Pipeline créa)"
        : null;

  const approval = pilotage?.site.find((row) => row.label === "Moyenne 7 jours")?.reignConversion ?? null;
  return {
    realRoas3: ramp.realRoas3,
    profit3: last3?.last3.profit ?? null,
    approval7: approval,
    open: !ramp.cap.frozen,
    breakeven: ramp.cap.thresholds.breakeven,
    rampActions: ramp.rows.filter((row) => row.status === "MONTER" || row.status === "REDESCENDRE" || row.status === "COUPER"),
    creatives,
    note,
    builtAt: new Date().toISOString(),
  };
}
