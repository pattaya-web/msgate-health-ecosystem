/**
 * Onglet « Ressources » du closer : les objections courantes des leads et
 * quoi répondre. Réponses tirées uniquement des scripts et du contrat
 * IBOState (rien d'inventé) ; Mady complétera la liste.
 *
 * `q` = ce que dit le lead ; `a` = la réponse à dire (en anglais, comme au téléphone).
 */

export type Objection = { title: string; q: string; a: string };

export const OBJECTIONS: Objection[] = [
  {
    title: "« C'est une arnaque ? »",
    q: "This sounds too good to be true. Is this a scam?",
    a: "I get it, and it's a fair question. Everything is in a written contract you read before signing. You never pay anything, ever: no fees, no deposit. And you receive $250 as soon as you sign, before you've done anything.",
  },
  {
    title: "« Je dois payer quelque chose ? »",
    q: "Do I have to pay anything to join?",
    a: "No. You never pay IBOState anything, not to apply, not to participate. No fees, no deposit, no investment. We pay you.",
  },
  {
    title: "« Combien je gagne ? »",
    q: "How much do I actually make?",
    a: "$1,000 to $2,000 a month for the role. On top of that, each small task is paid separately, $50 to $200. And $250 upfront when you sign the contract.",
  },
  {
    title: "« Ça prend combien de temps ? »",
    q: "How much time does it take? I already have a job.",
    a: "1 to 5 hours a month, that's the maximum. Small tasks from your phone, about 5 minutes each: a verification, a confirmation, a signature. Our team handles the paperwork and the day-to-day.",
  },
  {
    title: "« Pourquoi mon score de crédit ? »",
    q: "Why do you need my credit score?",
    a: "Because you become the local U.S. representative of a company. Our partners need someone in good standing for that role, so it's the one thing we can't skip. It's just the range, no hard inquiry.",
  },
  {
    title: "« Quels documents je dois envoyer ? »",
    q: "What documents will you need from me?",
    a: "A valid government ID and your driver's license, and your SSN if it's required for the company setup. Everything is explained step by step, and you only complete steps you understand and agree to.",
  },
  {
    title: "« Je suis employé de votre société ? »",
    q: "So am I an employee?",
    a: "No, you're an independent business representative, not an employee. It's all in the written agreement: your role, your responsibilities and the payments.",
  },
  {
    title: "« Je dois réfléchir »",
    q: "Let me think about it.",
    a: "Of course. What's the one thing you'd like to be sure about? (Answer it, then:) The contract takes 2 minutes to sign on your phone, and the $250 goes out right after. Want me to send it now so you can read it?",
  },
];
