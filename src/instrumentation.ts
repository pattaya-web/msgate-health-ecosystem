/**
 * Au démarrage du serveur : la copie de secours planifiée (src/lib/backup.ts).
 * Seulement côté Node — elle lit et écrit le disque.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackupScheduler } = await import("@/lib/backup");
    startBackupScheduler();
  }
}
