"use client";

import { useState } from "react";
import { BookOpen, Check, ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Le parcours complet pour mettre un site en ligne, écrit pour être suivi
 * sans rien connaître : de l'achat du nom de domaine jusqu'à l'URL envoyée à
 * la banque ou au processeur. Il reste sous la main, dans l'onglet, parce que
 * c'est au moment de le faire qu'on en a besoin — pas dans une conversation
 * d'il y a trois semaines.
 */

const APEX_IP = "216.198.79.1";
const WWW_CNAME = "cname.vercel-dns.com";
const APP_URL = "https://msgate-health-ecosystem.vercel.app";
const VERCEL_DOMAINS = "https://vercel.com/madys-projects-84d03991/msgate-health-ecosystem/settings/domains";

function CopyValue({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          toast.success("Copié");
          window.setTimeout(() => setDone(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-800 ring-1 ring-slate-900/[0.08] hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100"
      title="Copier"
    >
      {value}
      {done ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 text-slate-400" />}
    </button>
  );
}

const STEPS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "Achète le nom de domaine",
    body: (
      <>
        Chez n&apos;importe quel registrar (Namecheap, GoDaddy, OVH, Porkbun). Prends le <strong>.com</strong> quand il est libre : c&apos;est ce qu&apos;une
        banque ou un processeur attend d&apos;une marque US. Note le nom exact, sans <code>www</code> ni <code>https://</code>, par exemple{" "}
        <code>sage-renew.com</code>. Rien d&apos;autre à acheter : pas d&apos;hébergement, pas de SSL, l&apos;outil s&apos;en charge.
      </>
    ),
  },
  {
    title: "Crée le site dans l'outil et pose le domaine dedans",
    body: (
      <>
        <strong>Boutique</strong> (onglet Sites e-commerce) : crée-la ou copie un modèle, puis dans <em>Identité</em> → champ <em>Domaine</em>, colle le nom acheté.
        <br />
        <strong>Page agence</strong> (onglet Bank pages) : remplis le formulaire, colle le nom dans le champ <em>Domaine</em>, puis Créer. Sur une page déjà créée, le
        champ domaine est sous son nom dans la liste.
        <br />
        C&apos;est ce champ qui dit à l&apos;outil « ce nom, c&apos;est ce site ». Sans lui, le domaine n&apos;affichera rien.
      </>
    ),
  },
  {
    title: "Chez le registrar : deux lignes DNS",
    body: (
      <>
        Ouvre la gestion DNS du domaine (« DNS », « Zone DNS », « Advanced DNS » selon le site). Supprime les lignes déjà présentes sur <code>@</code> et{" "}
        <code>www</code> (souvent une page de parking), puis ajoute :
        <div className="mt-2 overflow-x-auto">
          <table className="text-[12px]">
            <thead className="text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="pr-4 text-left">Type</th>
                <th className="pr-4 text-left">Nom / Host</th>
                <th className="text-left">Valeur / Points to</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="pr-4 py-1 font-semibold">A</td>
                <td className="pr-4 py-1 font-mono">@</td>
                <td className="py-1">
                  <CopyValue value={APEX_IP} />
                </td>
              </tr>
              <tr>
                <td className="pr-4 py-1 font-semibold">CNAME</td>
                <td className="pr-4 py-1 font-mono">www</td>
                <td className="py-1">
                  <CopyValue value={WWW_CNAME} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        TTL : laisse la valeur par défaut. Enregistre.
      </>
    ),
  },
  {
    title: "Dans Vercel : déclare le domaine",
    body: (
      <>
        Va sur{" "}
        <a href={VERCEL_DOMAINS} target="_blank" rel="noreferrer" className="font-semibold underline">
          Vercel → Domains
        </a>{" "}
        → <em>Add Existing</em>. Ajoute le nom nu (<code>sage-renew.com</code>) : Vercel propose d&apos;ajouter <code>www</code> en même temps, accepte. Il affiche
        « Generating SSL Certificate » puis « Valid Configuration ». Si ça reste en attente plus d&apos;une heure, c&apos;est que l&apos;étape 3 n&apos;est pas passée :
        relis les deux lignes DNS.
      </>
    ),
  },
  {
    title: "Attends, puis vérifie",
    body: (
      <>
        Entre 10 minutes et quelques heures, le temps que le DNS se propage. Ouvre ensuite <code>https://www.le-domaine.com</code> dans un onglet privé : ton site doit
        s&apos;afficher, et <code>le-domaine.com</code> sans www doit y renvoyer. Pour une boutique, ouvre aussi <code>/shipping-policy</code> et{" "}
        <code>/contact</code>, et envoie-toi un message depuis le formulaire : il arrive dans « Messages reçus » de l&apos;éditeur.
      </>
    ),
  },
  {
    title: "Relis, puis envoie l'URL",
    body: (
      <>
        Boutique : la <em>Checklist underwriting</em> doit être au vert. Page agence : téléphone et e-mail joignables, adresse et raison sociale identiques aux
        documents de la LLC. Ensuite tu envoies <code>https://www.le-domaine.com</code> au processeur ou à la banque. Les corrections faites après dans l&apos;éditeur
        apparaissent en ligne toutes seules, sans rien redéployer.
      </>
    ),
  },
];

export function GoLiveGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200/70 dark:bg-amber-500/10 dark:ring-amber-500/20">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <BookOpen className="h-4 w-4 text-amber-700 dark:text-amber-300" />
        <span className="text-[12px] font-semibold text-amber-900 dark:text-amber-200">Mettre un site en ligne avec son nom de domaine — le parcours en 6 étapes</span>
        <span className="ml-auto hidden text-[11px] text-amber-800/70 md:inline dark:text-amber-200/70">boutique ou page agence, même parcours</span>
        <ChevronDown className={cn("h-4 w-4 text-amber-700 transition-transform dark:text-amber-300", open && "rotate-180")} />
      </button>
      {open ? (
        <ol className="space-y-3 px-3 pb-3 pt-1">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3 rounded-xl bg-white/80 p-3 text-[12px] leading-relaxed text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[12px] font-bold text-white">{index + 1}</span>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 dark:text-slate-50">{step.title}</p>
                <div className="mt-1">{step.body}</div>
              </div>
            </li>
          ))}
          <li className="px-3 text-[11px] text-slate-500">
            Sans nom de domaine, un site reste visible à <code>{APP_URL}/s/&lt;slug&gt;</code> (boutique) ou <code>{APP_URL}/p/&lt;slug&gt;</code> (page agence), mais une
            banque attend un vrai domaine.
          </li>
        </ol>
      ) : null}
    </div>
  );
}
