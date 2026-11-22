/**
 * Les scripts d'appel d'IBOState, recopiés des PDF de Mady (22/11/2026) :
 * - setting (IBO_State_Brandon_Setter_Script.pdf) : l'appel du lead qui vient
 *   de remplir le formulaire → qualifier et poser le 2e rendez-vous ;
 * - closing (IBOState-Call-Script-Kelly.pdf) : le call réservé → qualifier en
 *   détail, présenter l'offre, faire signer.
 *
 * « say » = à dire tel quel ; « q » = question numérotée ; « note » = consigne
 * pour le closer (pas à lire).
 */

export type ScriptLine = { t: "say" | "q" | "note"; text: string };
export type ScriptSection = { title: string; lines: ScriptLine[] };
export type CallScript = { key: string; title: string; goal: string; sections: ScriptSection[] };

const say = (text: string): ScriptLine => ({ t: "say", text });
const q = (text: string): ScriptLine => ({ t: "q", text });
const note = (text: string): ScriptLine => ({ t: "note", text });

export const SETTING_SCRIPT: CallScript = {
  key: "setting",
  title: "Script de setting (appel des leads)",
  goal: "Qualifier + poser un rendez-vous de 15 minutes (le call de closing).",
  sections: [
    {
      title: "Ouverture",
      lines: [
        say("Hey, is this [First name]?"),
        say("Hey! This is Brandon calling from IBO State."),
        say("I just saw you filled out a form on our website about our paid business opportunity. Are you still interested?"),
      ],
    },
    {
      title: "Le programme",
      lines: [
        say("Awesome! So basically, we work with European e-commerce companies that want to expand into the U.S."),
        say("We connect them with American residents who can act as local business partners."),
        say("It's a paid opportunity. You receive $250 when you get started, and depending on your agreement, you can earn between $1,500 and $2,000 per month."),
        say("It's a formal business partnership, with an agreement and responsibilities that our admissions manager will explain before you make any commitment."),
      ],
    },
    {
      title: "Qualification",
      lines: [
        say("I just have a few quick questions to see if you qualify."),
        q("Are you a U.S. citizen or green card holder?"),
        q("Is your credit score 650 or higher?"),
        q("Do you have any criminal convictions that could affect your eligibility?"),
        q("And what state are you currently living in?"),
      ],
    },
    {
      title: "Poser le rendez-vous",
      lines: [
        say("Perfect! The next step is a quick 15-minute Google Meet with Kelly, our admissions manager."),
        say("She'll explain exactly how everything works, including the compensation, legal structure, and responsibilities."),
        say("Would later today or tomorrow work better for you?"),
        say("Great! What time works best for you?"),
        say("Perfect, I'll send you the meeting details by text. Thanks, [First name]! Talk soon!"),
        note("Keep it natural. Let the candidate ask questions. Confirm their local time zone."),
      ],
    },
  ],
};

export const CLOSING_SCRIPT: CallScript = {
  key: "closing",
  title: "Script de closing (call réservé)",
  goal: "Call de qualification · 10 à 15 minutes max. Dire les phrases entre guillemets telles quelles ; les lignes grises sont des consignes.",
  sections: [
    {
      title: "Étape 1 — Ouverture (30 secondes)",
      lines: [
        say("Hi [First name], this is Kelly from IBOState. You filled out our application on the website, I'm calling to go over it with you. Do you have 10 minutes right now?"),
        note("No time: “No problem, when is a good time today or tomorrow?” Set an exact time and hang up. No pitch on the go."),
        say("Perfect. Quick heads-up: this call is just to make sure the program is a fit for you. I'll ask a few simple questions, then I'll explain how it works and what happens next. Sound good?"),
      ],
    },
    {
      title: "Étape 2 — Le contexte en 20 secondes",
      lines: [
        say("So in one sentence: European companies that open in the U.S. are required by law to have a U.S. citizen or resident as their local representative. That's the role. Our team handles everything, you handle a few small tasks from your phone, and you get paid for it. I'll give you the numbers in a minute."),
      ],
    },
    {
      title: "Étape 3 — Les questions de qualification (dans cet ordre)",
      lines: [
        note("Ask, listen, write down. Don't comment on the answers."),
        q("First, are you a U.S. citizen or a permanent resident with a green card?"),
        note("No = STOP."),
        q("Do you know your current credit score, roughly? Which range: below 650, 650 to 700, or above 700?"),
        note("Under 650 = STOP. “Not sure” = “Could you open your banking app or Credit Karma right now and tell me? It takes 30 seconds, and it's the one thing I can't skip.”"),
        q("Do you have a U.S. bank account in your name?"),
        note("No = “Could you open one this week? The monthly payments go there.” Still no = STOP."),
        q("Any back taxes or tax liens currently open with the IRS or your state?"),
        note("Open = STOP. Paid off = GO, write it down."),
        q("I have to ask this one, it's standard for a legal representative role: do you have any criminal record, anything at all, even old or minor?"),
        note("Ask it calmly, no apology. Yes = STOP, no discussion: “It's not personal, it's a legal requirement for the role.”"),
        q("Do you already own a company, an LLC, in the U.S.?"),
        note("Yes or no, both fine. If yes: “What's the name?” Write it down."),
        q("Are you currently working? Full-time, part-time, self-employed, retired?"),
        note("Both fine. Write it down."),
        q("Last one: if we send you a small task, how fast can you usually get back to us, same day?"),
        note("You want “yes, same day”. “Depends” or “maybe next week” = write “slow” on the sheet and say it in Step 4."),
      ],
    },
    {
      title: "Étape 4 — L'offre (seulement si les 5 sont GO)",
      lines: [
        say("Good news, you qualify. Here's how it works, and it's simple."),
        say("You become the local representative for one of our partner companies. Our team does the paperwork, the setup, the day-to-day. Nothing lands on you."),
        say("Your side: small tasks from your phone. A quick verification, a confirmation, a signature. Each one takes about 5 minutes. In total, 1 to 5 hours a month, that's the maximum."),
        say("You're paid $1,000 to $2,000 a month for the role. On top of that, each small task is paid separately, $50 to $200 per task."),
        say("And to show you we're serious: as soon as you sign the contract, you receive $250, upfront, before you've done anything."),
        say("Everything is in a written contract. It's legal, it's transparent, and you never pay anything, ever. No fees, no deposit."),
        say("The one thing we ask: be responsive. When we send a task, answer the same day. The faster you are, the more companies we can match you with."),
        note("Stop here. Two seconds of silence."),
        say("Does that make sense so far?"),
      ],
    },
    {
      title: "Étape 5 — La question de closing",
      lines: [
        say("So, are you in? If yes, I send you the contract right after this call, you sign it on your phone in 2 minutes, and the $250 goes out."),
        note("Yes = send the contract, confirm email and phone, welcome aboard. Hesitation = answer the objection once, then ask again. No = “No problem, thanks for your time.” Fill in the sheet anyway."),
      ],
    },
  ],
};

/** Remplace [First name] par le prénom du prospect quand on l'a. */
export function fillScript(text: string, fullName?: string) {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first ? text.replace(/\[First name\]/g, first) : text;
}

/**
 * Le but de chaque appel (consigne de Mady, 22/11/2026), affiché en haut du
 * poste closer, sur la fiche du lead et sur la fiche du call.
 */
export const CALL_GOAL = {
  title: "Le but de chaque appel",
  points: [
    "Le lead comprend bien notre programme.",
    "Il sait qu'il est rémunéré : entre 1 000 et 2 000 $ par mois pour ce rôle (+ 250 $ à la signature).",
    "Il est d'accord pour envoyer ses documents.",
    "Il s'engage à répondre vite aux messages et aux appels.",
  ],
};

/** Le contrat envoyé au lead qui dit oui (servi aux closers par /api/closer/contrat). */
export const CONTRACT_FILE = "IBOState_IBO_Agreement.pdf";
