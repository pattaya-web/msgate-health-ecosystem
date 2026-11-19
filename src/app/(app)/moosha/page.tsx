import { redirect } from "next/navigation";

/** L'espace Moosha ouvre sur son Studio IA. */
export default function MooshaPage() {
  redirect("/moosha/studio");
}
