"use client";

import { DriveExplorer } from "@/components/drive/drive-explorer";
import { BackupBar } from "@/components/drive/backup-bar";
import { useAuth } from "@/lib/auth/auth-context";

/**
 * Le Drive. L'admin voit tout l'arbre et l'état de la copie de secours ;
 * l'associé voit le dossier « Commun » comme racine (filtré côté serveur).
 */
export default function DrivePage() {
  const { isAdmin, isAssociate } = useAuth();
  return (
    <>
      {isAdmin && !isAssociate ? <BackupBar /> : null}
      <DriveExplorer />
    </>
  );
}
