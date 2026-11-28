import { redirect } from "next/navigation";

/** MoneyTalk (la paie d'Alison) est supprimé le 28/11/2026 : l'ancien lien mène au Profit. */
export default function MoneyTalkPage() {
  redirect("/associate/profit");
}
