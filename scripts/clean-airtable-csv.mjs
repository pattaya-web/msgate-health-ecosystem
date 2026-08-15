import fs from "fs";
import path from "path";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        continue;
      }
      field += c;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += c;
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

function toCsv(rows) {
  return (
    rows
      .map((r) =>
        r
          .map((cell) => {
            const s = String(cell ?? "");
            if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
          })
          .join(",")
      )
      .join("\n") + "\n"
  );
}

function strip(filePath, dropIncludes, outPath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(raw);
  const headers = rows[0].map((h) => h.trim());
  const keepIdx = headers
    .map((h, i) => {
      const lower = h.toLowerCase();
      const drop = dropIncludes.some((d) => lower.includes(d.toLowerCase()));
      return drop ? -1 : i;
    })
    .filter((i) => i >= 0);

  const cleaned = rows.map((r) => keepIdx.map((i) => r[i] ?? ""));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, toCsv(cleaned), "utf8");
  return {
    kept: keepIdx.map((i) => headers[i]),
    dropped: headers.filter((_, i) => !keepIdx.includes(i)),
    rows: cleaned.length - 1,
  };
}

const outDir =
  "C:/Users/madyc/OneDrive/Bureau/MSGATE Health Ecosytem/data/airtable-clean";

const ibo = strip(
  "C:/Users/madyc/Downloads/ID IBO-Grid view.csv",
  [
    "mail",
    "password",
    "pawword",
    "driver",
    "dl expiration",
    "document",
    // safety: never keep identity PII in the repo
    "ssn",
    "date of birth",
    "address",
  ],
  path.join(outDir, "ibo-clean.csv")
);

const llc = strip(
  "C:/Users/madyc/Downloads/LLCs-Grid view.csv",
  ["mail", "password", "document", "drive", "proton", "host"],
  path.join(outDir, "llc-clean.csv")
);

console.log(JSON.stringify({ ibo, llc }, null, 2));
