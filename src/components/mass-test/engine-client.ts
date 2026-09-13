import type { ProductContext, TestBatch } from "@/lib/creative-engine/types";

/** Appels au moteur, partagés par les panneaux du Mass test. */
export async function enginePost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/creative-engine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Opération impossible");
  return data;
}

export async function engineGet(): Promise<{ products: ProductContext[]; batches: TestBatch[] }> {
  const res = await fetch("/api/creative-engine", { cache: "no-store" });
  const data = (await res.json()) as { products?: ProductContext[]; batches?: TestBatch[]; error?: string };
  if (!res.ok) throw new Error(data.error || "Lecture impossible");
  return { products: data.products ?? [], batches: data.batches ?? [] };
}

export function itemImageUrl(batchId: string, file: string, name?: string, download = false) {
  const params = new URLSearchParams({ batch: batchId, file });
  if (name) params.set("name", `${name}.png`);
  if (download) params.set("download", "1");
  return `/api/creative-engine/file?${params}`;
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export const panel = "rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]";

export function chip(on: boolean, extra = "") {
  return [
    "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
    on ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300",
    extra,
  ].join(" ");
}
