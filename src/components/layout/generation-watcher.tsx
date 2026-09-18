"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { engineGet, enginePost } from "@/components/mass-test/engine-client";
import { saveStaticCreative } from "@/lib/studio/client";
import { claimTask, isStaticStudioMounted, releaseTask, STUDIO_JOBS_KEY } from "@/lib/studio/generation-registry";

/**
 * Le veilleur des générations, monté dans le shell : tant qu'une créa est en
 * cours quelque part (espace produit, Ask Hermes, Mass test, studio static),
 * elle avance et se range même si l'opérateur est parti sur un autre écran.
 * Un petit badge dit combien tournent, et ramène au bon endroit.
 */

const ENGINE_EVERY_MS = 6000;
const STUDIO_EVERY_MS = 4000;

type StoredJob = {
  id: string;
  prompt: string;
  taskId?: string;
  urls: string[];
  status: "idle" | "run" | "ok" | "err";
  error?: string;
  saved?: boolean;
  brief: string;
  ratio: string;
  resolution: string;
  referenceUrls: string[];
  createdAt: string;
  kind?: "image" | "video";
};

function readJobs(): StoredJob[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STUDIO_JOBS_KEY) || "[]") as StoredJob[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function patchStoredJob(id: string, patch: Partial<StoredJob>) {
  try {
    const jobs = readJobs();
    window.localStorage.setItem(STUDIO_JOBS_KEY, JSON.stringify(jobs.map((job) => (job.id === id ? { ...job, ...patch } : job))));
  } catch {
    // stockage indisponible : le studio reprendra la tâche à son prochain montage
  }
}

export function GenerationWatcher() {
  const [engineRunning, setEngineRunning] = useState(0);
  const [studioRunning, setStudioRunning] = useState(0);

  // Lots du moteur : rafraîchis côté serveur tant qu'un item attend Kie.
  useEffect(() => {
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const data = await engineGet();
        const pending = data.batches.filter((batch) => batch.items.some((item) => item.state === "pending" && item.taskId));
        if (!stopped) setEngineRunning(pending.reduce((sum, batch) => sum + batch.items.filter((item) => item.state === "pending").length, 0));
        for (const batch of pending) {
          if (stopped) break;
          await enginePost({ action: "refresh", batchId: batch.id }).catch(() => undefined);
        }
      } catch {
        // hors ligne ou déconnecté : on réessaiera
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), ENGINE_EVERY_MS);
    const first = setTimeout(() => void tick(), 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(first);
    };
  }, []);

  // Tâches du studio static : sondées ici seulement quand le studio n'est pas là pour le faire.
  useEffect(() => {
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const cutoff = Date.now() - 2 * 60 * 60 * 1000;
        const running = readJobs().filter((job) => job.status === "run" && job.taskId && new Date(job.createdAt).getTime() >= cutoff);
        if (!stopped) setStudioRunning(running.length);
        if (isStaticStudioMounted()) return;
        for (const job of running) {
          if (stopped) break;
          const taskId = job.taskId as string;
          if (!claimTask(taskId)) continue;
          try {
            const res = await fetch(`/api/studio?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" });
            if (!res.ok) continue;
            const body = (await res.json()) as { state?: string; urls?: string[]; failMsg?: string };
            const state = (body.state || "").toLowerCase();
            if ((state === "success" || state === "completed" || state === "finished") && body.urls?.length) {
              let saved = false;
              try {
                await saveStaticCreative({ brief: job.brief, prompt: job.prompt, ratio: job.ratio as "3:4", resolution: job.resolution === "2K" ? "2K" : "1K", resultUrls: body.urls, referenceUrls: job.referenceUrls, media: job.kind ?? "image" });
                saved = true;
              } catch {
                // la bibliothèque n'a pas pris : le rendu reste visible dans la grille
              }
              patchStoredJob(job.id, { urls: body.urls, status: "ok", saved });
            } else if (state === "fail" || state === "failed" || state === "error") {
              patchStoredJob(job.id, { status: "err", error: body.failMsg || "Génération échouée" });
            }
          } catch {
            // réseau : prochain passage
          } finally {
            releaseTask(taskId);
          }
        }
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), STUDIO_EVERY_MS);
    const first = setTimeout(() => void tick(), 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(first);
    };
  }, []);

  const total = engineRunning + studioRunning;
  if (!total) return null;
  return (
    <Link
      href="/studio/static"
      className="fixed bottom-6 left-4 z-30 inline-flex items-center gap-1.5 rounded-full bg-slate-950/85 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg backdrop-blur-md hover:bg-slate-900 lg:left-[248px]"
      title="Les générations continuent pendant que tu navigues"
      data-generation-watcher={total}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      {total} créa{total > 1 ? "s" : ""} en cours
    </Link>
  );
}
