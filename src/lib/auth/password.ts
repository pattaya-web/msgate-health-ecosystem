import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Mots de passe : hachés avec scrypt, jamais stockés en clair.
 *
 * scrypt est dans Node, sans dépendance ni binaire : il tourne tel quel sur
 * Vercel. Le format stocké porte ses paramètres, ce qui permet de les durcir
 * plus tard sans invalider les comptes existants :
 *
 *   $scrypt$N=32768,r=8,p=1$<sel base64url>$<clé base64url>
 */

/** scrypt en promesse, avec ses options : promisify perd la signature à quatre arguments. */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

const DEFAULT_PARAMS = { N: 32768, r: 8, p: 1 };
const SALT_BYTES = 32;
const KEY_BYTES = 64;

function b64url(buffer: Buffer) {
  return buffer.toString("base64url");
}

export async function hashPassword(password: string, params = DEFAULT_PARAMS) {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_BYTES, {
    ...params,
    maxmem: 256 * params.N * params.r,
  });
  return `$scrypt$N=${params.N},r=${params.r},p=${params.p}$${b64url(salt)}$${b64url(key)}`;
}

export type ParsedHash = { N: number; r: number; p: number; salt: Buffer; key: Buffer };

export function parseHash(stored: string): ParsedHash | null {
  const match = /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(stored.trim());
  if (!match) return null;
  const N = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  if (!Number.isInteger(N) || N < 1024 || (N & (N - 1)) !== 0 || r < 1 || p < 1) return null;
  const salt = Buffer.from(match[4], "base64url");
  const key = Buffer.from(match[5], "base64url");
  if (salt.length < 16 || key.length < 32) return null;
  return { N, r, p, salt, key };
}

/** Vrai si le mot de passe correspond au hash. Un hash illisible vaut « faux », jamais une exception. */
export async function verifyPassword(password: string, stored: string) {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  try {
    const key = await scrypt(password.normalize("NFKC"), parsed.salt, parsed.key.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 256 * parsed.N * parsed.r,
    });
    return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  } catch {
    return false;
  }
}
