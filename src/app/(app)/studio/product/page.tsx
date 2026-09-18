import { redirect } from "next/navigation";

/** Le produit a sa page dans « Création » : le catalogue. La créa se fait dans Static. */
export default function StudioProductPage() {
  redirect("/products");
}
