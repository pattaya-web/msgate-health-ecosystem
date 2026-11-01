// Repris de princexd (mvdyprince.fr), même proxy Traefik devant.
/**
 * Préchargé par `node -r ./keepalive.cjs server.js` dans l'image Docker (à la racine : `scripts/` est exclu du build).
 *
 * Node ferme une connexion keep-alive inactive après 5 s ; Traefik (le proxy
 * de Coolify) garde les siennes 90 s et réutilise une connexion que Node est
 * en train de fermer. Un GET est rejoué, un POST non : il ressort en 502
 * « Bad Gateway » sans que l'application ait rien vu (vu sur la création
 * vidéo du Studio d'un élève, le 2026-10-28). On garde donc les connexions
 * plus longtemps que le proxy, et le délai d'en-têtes au-dessus (Node le
 * demande).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- préchargé par `node -r`, hors du bundle Next
const http = require("node:http");
const KEEP_ALIVE_MS = Number(process.env.KEEP_ALIVE_TIMEOUT) || 125_000;
const orig = http.createServer;
http.createServer = function createServerWithLongKeepAlive(...args) {
  const server = orig.apply(this, args);
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 5_000;
  return server;
};
