/**
 * Au démarrage du serveur : la copie de secours planifiée (src/lib/backup.ts).
 * Seulement côté Node — elle lit et écrit le disque.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Le compteur des appels vers Meta (limite « development_access ») : /api/meta/usage.
    const { installMetaUsageLog } = await import("@/lib/meta/usage-log");
    installMetaUsageLog();
    const { startBackupScheduler } = await import("@/lib/backup");
    startBackupScheduler();
  }
}
