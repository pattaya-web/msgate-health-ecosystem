/**
 * Les scripts d'appel d'IBOState, recopiés des PDF de Mady (22/11/2026) :
 * - setting (IBO_State_Call_Script.pdf, Kelly Miguez, 23/11/2026 ; remplace celui de Brandon) : l'appel du lead qui vient
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
  goal: "Confirmer son dossier + poser le Google Meet de 15 à 20 min avec le Head of Admissions.",
  sections: [
    {
      title: "Ouverture",
      lines: [
        say("Hi, is this [First name]?"),
        say("Hi [First name], this is Kelly Miguez with IBO State. How are you doing today?"),
        say("I'm reaching out because you recently requested information on our website about joining the Happy Hosted program."),
        say("I just wanted to briefly go over your application and confirm a few details with you."),
      ],
    },
    {
      title: "Le programme",
      lines: [
        say("Perfect! So, to give you a quick overview, IBO State connects U.S. citizens with European entrepreneurs who run e-commerce businesses in the U.S. market."),
        say("These companies are looking for local U.S. representatives to work with them under a formal agreement."),
        say("If you're eligible and your application is approved, the role pays between $1,000 and $2,000 per month, depending on the terms of the agreement."),
        say("There's also an initial $250 payment when you sign the agreement, provided your application is approved and we both agree to move forward."),
        say("Does that make sense so far?"),
      ],
    },
    {
      title: "Qualification",
      lines: [
        say("Great! I already have most of your information from the form you filled out. I just want to confirm a few things."),
        q("You're a U.S. citizen, correct?"),
        q("Is your credit score at least 600?"),
        q("Do you have any criminal convictions on your record?"),
        q("Do you currently have an active U.S. bank account?"),
        q("Do you have any unpaid back taxes or outstanding tax liens?"),
        q("And lastly, are you generally responsive to messages and available to communicate with our team when needed?"),
      ],
    },
    {
      title: "Poser le rendez-vous",
      lines: [
        say("Perfect. Based on what you've told me, your profile seems to meet our initial requirements."),
        say("In that case, I'd like to schedule a quick Google Meet call with our Head of Admissions."),
        say("The call takes about 15 to 20 minutes. They'll walk you through how the program works, what the collaboration looks like, the requirements, and review your eligibility in more detail."),
        say("What does your availability look like tomorrow or later this week?"),
        note("Wait for their response."),
        say("Great! I have [Time Option 1] or [Time Option 2] available. Which works better for you?"),
        note("Confirm the date, time, and time zone. Puis « + Rendez-vous » dans le CRM, à SON heure."),
        say("Perfect. I'll send you the Google Meet invitation with all the details."),
        say("You'll also have a chance to ask any questions so you can fully understand the program and the responsibilities involved."),
        say("Perfect, [First name], your meeting is scheduled!"),
        say("Thanks so much for your time. It was great speaking with you."),
        say("Have a wonderful day, and talk soon!"),
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
