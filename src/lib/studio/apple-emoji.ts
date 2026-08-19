/** Apple Color Emoji PNGs (iPhone look) via emoji-datasource-apple. */
export const APPLE_EMOJIS = [
  { glyph: "🔥", unified: "1f525" },
  { glyph: "😭", unified: "1f62d" },
  { glyph: "😍", unified: "1f60d" },
  { glyph: "😱", unified: "1f631" },
  { glyph: "🤯", unified: "1f92f" },
  { glyph: "👀", unified: "1f440" },
  { glyph: "✨", unified: "2728" },
  { glyph: "💯", unified: "1f4af" },
  { glyph: "⚠️", unified: "26a0-fe0f" },
  { glyph: "❌", unified: "274c" },
  { glyph: "✅", unified: "2705" },
  { glyph: "➡️", unified: "27a1-fe0f" },
  { glyph: "👇", unified: "1f447" },
  { glyph: "👉", unified: "1f449" },
  { glyph: "❤️", unified: "2764-fe0f" },
  { glyph: "💀", unified: "1f480" },
  { glyph: "🧢", unified: "1f9e2" },
  { glyph: "🧴", unified: "1f9f4" },
  { glyph: "💊", unified: "1f48a" },
  { glyph: "🛒", unified: "1f6d2" },
  { glyph: "💰", unified: "1f4b0" },
  { glyph: "🇺🇸", unified: "1f1fa-1f1f8" },
  { glyph: "🤩", unified: "1f929" },
  { glyph: "😤", unified: "1f624" },
] as const;

export function appleEmojiUrl(unified: string, size: 64 | 160 = 64) {
  return `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/${size}/${unified}.png`;
}
