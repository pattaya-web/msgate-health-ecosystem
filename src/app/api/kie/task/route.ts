import { NextRequest, NextResponse } from "next/server";
import { getTask, KieError } from "@/lib/kie";
import { readDB, writeDB } from "@/lib/db";
import { warmThumb } from "@/lib/thumbs";

export const dynamic = "force-dynamic";

/**
 * Rafraîchit une ou plusieurs générations en cours.
 * Sans paramètre, reprend toutes les tâches encore ouvertes — c'est ce que
 * le Studio appelle en boucle tant qu'il reste quelque chose à attendre.
 */
export async function GET(req: NextRequest) {
  const one = req.nextUrl.searchParams.get("taskId");
  /*
   * `list=1` : le client suivait des rendus et veut la liste meme si plus
   * rien n'est en attente. Sur le VPS, KIE previent le serveur par rappel
   * (/api/kie/callback) : la generation passe en « success » entre deux
   * sondages, et sans ce parametre la reponse repartait sans generations.
   * Le dock ne rediffusait rien, la case restait sur le chrono jusqu'a F5.
   */
  const wantList = req.nextUrl.searchParams.get("list") === "1";
  const db = readDB();
  const pending = db.generations.filter(
    (g) => (one ? g.taskId === one : g.state !== "success" && g.state !== "fail"),
  );
  if (!pending.length) {
    return NextResponse.json(
      wantList
        ? { updated: [], remaining: 0, generations: db.generations.slice(0, 60) }
        : { updated: [], remaining: 0 },
    );
  }

  const updated: string[] = [];
  let changed = false;
  // Les taches sont interrogees en parallele : en serie, douze appels de
  // 300 ms depassaient l'intervalle de sondage et empilaient les requetes.
  const batch = pending.slice(0, 12);
  const results = await Promise.allSettled(batch.map((gen) => getTask(gen.taskId)));
  for (const [i, gen] of batch.entries()) {
    const r = results[i];
    if (r.status === "rejected") {
      // Une tâche qui échoue à répondre ne doit pas bloquer les autres.
      const msg = (r.reason as KieError)?.message ?? String(r.reason);
      if (gen.failMsg !== msg) {
        gen.failMsg = msg;
        changed = true;
      }
      continue;
    }
    const rec = r.value;
    const same =
      gen.state === rec.state &&
      gen.progress === rec.progress &&
      gen.failMsg === rec.failMsg &&
      gen.creditsConsumed === rec.creditsConsumed &&
      JSON.stringify(gen.resultUrls ?? []) === JSON.stringify(rec.resultUrls);
    // Rien n'a bouge chez KIE : on ne reecrit pas plusieurs Mo pour rien.
    if (same) continue;
    changed = true;
    gen.state = rec.state;
    gen.resultUrls = rec.resultUrls;
    for (const u of rec.resultUrls ?? []) warmThumb(u);
    gen.creditsConsumed = rec.creditsConsumed;
    gen.failMsg = rec.failMsg;
    gen.progress = rec.progress;
    /*
     * On mesure nous-memes, et on ignore le `costTime` de KIE.
     *
     * Il est publie sans unite documentee : une tache de 600 s reelles
     * renvoyait 600, qu'on divisait par 1000 en le croyant en
     * millisecondes — d'ou les « genere en 0 min 01 » affiches sur des
     * generations de dix minutes. Notre propre mesure n'a pas d'ambiguite.
     */
    if (!gen.costTimeSec && (rec.state === "success" || rec.state === "fail")) {
      gen.costTimeSec = Math.max(
        1,
        Math.round((Date.now() - new Date(gen.createdAt).getTime()) / 1000),
      );
    }
    gen.updatedAt = new Date().toISOString();
    updated.push(gen.taskId);
  }
  if (changed) writeDB(db);

  const remaining = db.generations.filter((g) => g.state !== "success" && g.state !== "fail").length;
  return NextResponse.json({ updated, remaining, generations: db.generations.slice(0, 60) });
}
