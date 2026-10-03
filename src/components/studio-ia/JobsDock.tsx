"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getModel } from "@/lib/models";
import { estimateSec, label } from "@/lib/format";
import type { Generation } from "@/lib/types";
import { engineLabel } from "@/lib/studio-ia/config";
import { STATUS_LABEL } from "@/lib/studio-ia/labels";
import { ACTIVE_STATUSES, type StudioJob } from "@/lib/studio-ia/types";

/**
 * Suivi des generations en cours, present sur toutes les pages.
 *
 * Le calcul se fait chez le fournisseur : changer d'onglet ne l'interrompt
 * jamais. En revanche, c'est ce sondage qui rapatrie le resultat dans la base.
 * En le montant dans le Shell plutot que dans le Studio, le travail continue
 * d'etre suivi et enregistre pendant qu'on se balade dans le reste du site.
 *
 * C'est aussi l'unique sondeur de l'application : le Studio ne fait qu'ecouter
 * l'evenement diffuse ici, pour eviter deux boucles concurrentes.
 */

/** Evenement de diffusion vers les pages interessees. */
export const GENERATIONS_EVENT = "princexd:generations";
/** Meme principe pour les jobs du Swap video : le dock sonde, le Studio ecoute. */
export const STUDIO_JOBS_EVENT = "princexd:studio-jobs";

/** Derniere liste de jobs recue par le dock : la page Studio la reprend sans refaire l'appel. */
let lastStudioJobs: StudioJob[] | null = null;
export const readStudioJobsCache = () => lastStudioJobs;

/**
 * Un seul sondage a la fois : le dock et la page Studio montent ensemble et
 * demandaient chacun la liste (250 Ko) au meme instant.
 */
let studioPending: Promise<{ jobs?: StudioJob[] }> | null = null;
let lastStudioAt = 0;
/** `maxAgeMs` : une liste plus recente que ca est rendue sans appel reseau. */
export function fetchStudioJobs(maxAgeMs = 0): Promise<{ jobs?: StudioJob[] }> {
  if (lastStudioJobs && maxAgeMs > 0 && Date.now() - lastStudioAt < maxAgeMs) {
    return Promise.resolve({ jobs: lastStudioJobs });
  }
  if (!studioPending) {
    studioPending = fetch("/api/studio-ia/jobs", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ jobs?: StudioJob[] }>)
      .then((body) => {
        if (body.jobs) {
          lastStudioJobs = body.jobs;
          lastStudioAt = Date.now();
        }
        return body;
      })
      .finally(() => { studioPending = null; });
  }
  return studioPending;
}

/** Cadence rapide quand quelque chose tourne, lente le reste du temps. */
const TICK_ACTIVE = 3000;
const TICK_IDLE = 15000;

/** Durees relevees sur les generations reelles, pour donner une echelle. */
const TYPICAL_SEC: Record<string, number> = { image: 120, video: 480 };

function mmss(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")}` : `${s} s`;
}

function useElapsed(from: string) {
  const compute = useCallback(
    () => Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 1000)),
    [from],
  );
  const [n, setN] = useState(compute);
  useEffect(() => {
    setN(compute());
    const id = setInterval(() => setN(compute()), 1000);
    return () => clearInterval(id);
  }, [compute]);
  return n;
}

function Job({ gen, history }: { gen: Generation; history: Generation[] }) {
  const elapsed = useElapsed(gen.createdAt);
  const def = getModel(gen.model);
  const name = def?.name ?? gen.model.split("/").pop() ?? gen.model;
  const vendor = def?.vendor;

  /*
   * KIE ne renvoie que « waiting » puis « success » pour les modeles video :
   * l'etat « generating » n'apparait jamais. Impossible donc de distinguer
   * l'attente du calcul — et affirmer que le calcul n'a pas commence etait
   * faux pendant toute la duree de la tache.
   */
  const opaque = gen.state === "waiting" || gen.state === "queuing";
  // Mediane des generations reussies avec ce meme modele.
  const typical = estimateSec(gen.model, history)?.sec ?? TYPICAL_SEC[gen.kind] ?? 300;
  const real = gen.progress > 0;
  const left = typical - elapsed;
  const pct = real ? gen.progress : Math.min(95, Math.round((elapsed / typical) * 100));

  return (
    <li className="px-3 py-2.5" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[12.5px] font-medium truncate" title={name}>{name}</span>
        <span className="num text-[12px] tabular-nums shrink-0">{mmss(elapsed)}</span>
      </div>

      <div className="rounded-full overflow-hidden mb-1" style={{ height: 4, background: "var(--border)" }}>
        {opaque ? (
          <div className="h-full rounded-full sliding" style={{ width: "35%", background: "var(--accent)" }} />
        ) : (
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(pct, 4)}%`, background: "var(--accent)", transition: "width .6s ease" }}
          />
        )}
      </div>

      <span className="dim text-[10.5px]">
        {opaque
          ? `Chez ${vendor ?? "le fournisseur"} · ${left > 0 ? `≈ ${mmss(left)} restantes` : "ça dépasse la durée habituelle"}`
          : real
            ? `${label(gen.state)} · ${pct} %`
            : left > 0
              ? `${label(gen.state)} · ≈ ${mmss(left)} restantes`
              : `${label(gen.state)} · ça dépasse la durée habituelle`}
      </span>
    </li>
  );
}

function StudioLine({ job }: { job: StudioJob }) {
  const elapsed = useElapsed(job.startedAt || job.createdAt);
  const name = `${job.type === "talking-photo" ? "Photo qui parle" : job.type === "creation" ? "Création" : "Swap vidéo"} · ${engineLabel(job.provider)}`;
  const real = job.status === "generating_video" && job.progress > 0;
  return (
    <li className="px-3 py-2.5" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[12.5px] font-medium truncate" title={name}>{name}</span>
        <span className="num text-[12px] tabular-nums shrink-0">{mmss(elapsed)}</span>
      </div>
      <div className="rounded-full overflow-hidden mb-1" style={{ height: 4, background: "var(--border)" }}>
        {real ? (
          <div className="h-full rounded-full" style={{ width: `${Math.max(job.progress, 4)}%`, background: "var(--accent)", transition: "width .6s ease" }} />
        ) : (
          <div className="h-full rounded-full sliding" style={{ width: "35%", background: "var(--accent)" }} />
        )}
      </div>
      <span className="dim text-[10.5px]">
        {STATUS_LABEL[job.status]}
        {real ? ` · ${job.progress} %` : ""}
      </span>
    </li>
  );
}

export function JobsDock() {
  const [jobs, setJobs] = useState<Generation[]>([]);
  const [history, setHistory] = useState<Generation[]>([]);
  const [studio, setStudio] = useState<StudioJob[]>([]);
  const lastStudioSig = useRef("");
  const [open, setOpen] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Empreinte de la derniere reponse : identique, on ne touche a rien.
  const lastSig = useRef("");
  // Vrai tant que la derniere liste diffusee contenait un rendu en cours.
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      let active = false;
      try {
        /*
         * Quand on suivait un rendu, on reclame la liste meme si le serveur
         * n'a plus rien en attente : KIE a pu le terminer par rappel entre
         * deux tours, et c'est cette diffusion qui remplace le chrono par la
         * vignette. Sans ca, la page restait sur « en cours » jusqu'a F5.
         */
        const res = await fetch(inFlight.current ? "/api/kie/task?list=1" : "/api/kie/task", { cache: "no-store" });
        const body = (await res.json()) as { remaining?: number; generations?: Generation[] };
        if (!alive) return;

        if (body.generations) {
          inFlight.current = body.generations.some((g) => g.state !== "success" && g.state !== "fail");
          /*
           * Chaque diffusion faisait re-rendre toute la galerie du Studio,
           * meme quand KIE n'avait rien de neuf : c'est ce qui donnait
           * l'impression d'un ecran qui saccade toutes les 3 secondes.
           */
          const sig = JSON.stringify(body.generations);
          if (sig !== lastSig.current) {
            lastSig.current = sig;
            // Les pages affichant la galerie se mettent a jour sans resonder.
            window.dispatchEvent(new CustomEvent(GENERATIONS_EVENT, { detail: body.generations }));
            setHistory(body.generations);
            setJobs(body.generations.filter((g) => g.state !== "success" && g.state !== "fail"));
          }
        } else if (lastSig.current !== "[]") {
          lastSig.current = "[]";
          setJobs([]);
        }
        active = (body.remaining ?? 0) > 0;
      } catch {
        // Coupure reseau ponctuelle : on retentera au prochain tour.
      }
      try {
        // Le meme appel fait avancer la file du Swap video cote serveur.
        // Premier tour juste apres l'appel initial de la page Studio : on reprend sa liste.
        const body = await fetchStudioJobs(2000);
        if (!alive) return;
        if (body.jobs) {
          const sig = JSON.stringify(body.jobs);
          if (sig !== lastStudioSig.current) {
            lastStudioSig.current = sig;
            window.dispatchEvent(new CustomEvent(STUDIO_JOBS_EVENT, { detail: body.jobs }));
            setStudio(body.jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)));
          }
          if (body.jobs.some((j) => ACTIVE_STATUSES.includes(j.status))) active = true;
        }
      } catch {
        // Idem : on retentera.
      }
      if (alive) timer.current = setTimeout(tick, active ? TICK_ACTIVE : TICK_IDLE);
    };

    void tick();

    /*
     * Telephone : l'onglet en arriere-plan est gele, le minuteur ne tourne
     * plus. Au retour (onglet visible, fenetre au premier plan, reseau
     * revenu), on sonde tout de suite au lieu d'attendre le prochain tour :
     * un rendu fini pendant l'absence apparait a la seconde.
     */
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      if (timer.current) clearTimeout(timer.current);
      void tick();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const total = jobs.length + studio.length;
  if (!total) return null;

  // Position : .jobs-dock dans globals.css — en bas à droite, sauf sur téléphone
  // où il passe sous l'en-tête pour ne pas couvrir le panneau de swap.
  return (
    <div className="jobs-dock fixed z-30 rise">
      <div className="card overflow-hidden" style={{ boxShadow: "var(--shadow-lg)" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full px-3 py-2.5 flex items-center gap-2 text-left"
          style={{ background: "var(--surface-2)" }}
        >
          <span className="spinner shrink-0" />
          <span className="text-[12.5px] font-semibold flex-1">
            {total} génération{total > 1 ? "s" : ""} en cours
          </span>
          <span className="dim text-[11px]">{open ? "▾" : "▸"}</span>
        </button>

        {open && (
          <ul className="max-h-[260px] overflow-y-auto">
            {studio.map((j) => (
              <StudioLine key={j.id} job={j} />
            ))}
            {jobs.map((g) => (
              <Job key={g.id} gen={g} history={history} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
