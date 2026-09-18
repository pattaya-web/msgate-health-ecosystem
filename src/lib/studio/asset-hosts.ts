/**
 * Les hôtes que le proxy d'assets du studio accepte de relayer : les CDN des
 * rendus et des envois (Kie, S3, CloudFront…). Une photo de fiche produit
 * (Shopify, boutique) se charge directement : ces CDN sont publics et le
 * proxy la refuserait.
 */
export const PROXIED_HOSTS = /(aiquickdraw|kie\.ai|redpandaai\.co|amazonaws\.com|cloudfront\.net|aliyuncs\.com|googleapis\.com)/i;

export function isProxiedAsset(url: string) {
  return /^https:\/\//i.test(url) && PROXIED_HOSTS.test(url);
}
