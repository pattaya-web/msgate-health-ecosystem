"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { libraryFileUrl } from "@/lib/studio/client";
import { STUDIO_REUSE_KEY, type StaticCreative } from "@/lib/studio/library-types";
import { cn } from "@/lib/utils";

export function StaticLibrary() {
  const router = useRouter();
  const [items, setItems] = useState<StaticCreative[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<StaticCreative | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/studio/library");
      const body = (await res.json()) as { items?: StaticCreative[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Bibliothèque illisible");
      setItems(body.items || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bibliothèque illisible");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(id: string) {
    const res = await fetch(`/api/studio/library/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Suppression impossible");
      return;
    }
    setItems((list) => list.filter((item) => item.id !== id));
    if (open?.id === id) setOpen(null);
    toast.success("Créa retirée");
  }

  async function reuse(item: StaticCreative) {
    const refDataUrls = await Promise.all(
      item.refFiles.map(async (file) => {
        const blob = await fetch(libraryFileUrl(item.id, file)).then((res) => res.blob());
        return blobToDataUrl(blob);
      })
    );
    sessionStorage.setItem(
      STUDIO_REUSE_KEY,
      JSON.stringify({ brief: item.brief, prompt: item.prompt, refDataUrls })
    );
    router.push("/studio/static");
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-500">
        {loading ? "Chargement…" : items.length ? `${items.length} créative${items.length > 1 ? "s" : ""}` : "Aucune créa encore — génère depuis Static"}
      </p>
      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setOpen(item)}
              className="overflow-hidden rounded-xl bg-white text-left ring-1 ring-slate-900/[0.06] transition hover:ring-slate-900/20 dark:bg-slate-900"
            >
              <div
                className={cn(
                  "bg-slate-100 dark:bg-slate-800",
                  item.ratio === "1:1" ? "aspect-square" : item.ratio === "9:16" ? "aspect-[9/16]" : "aspect-[3/4]"
                )}
              >
                {item.resultFiles[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={libraryFileUrl(item.id, item.resultFiles[0])} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="px-2 py-1.5">
                <p className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">{item.prompt}</p>
                <p className="text-[10px] text-slate-400">
                  {item.ratio} · {item.resolution} · {new Date(item.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto dark:border-slate-800 dark:bg-slate-950">
          {open ? (
            <>
              <DialogHeader>
                <DialogTitle>Créa static</DialogTitle>
                <DialogDescription>
                  {open.ratio} · {open.resolution} · {new Date(open.createdAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-2">
                  {open.resultFiles.map((file) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={file}
                      src={libraryFileUrl(open.id, file)}
                      alt=""
                      className="w-full rounded-xl ring-1 ring-slate-900/10"
                    />
                  ))}
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Prompt</p>
                    <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-2.5 text-[12px] leading-relaxed dark:bg-slate-900">
                      {open.prompt}
                    </p>
                  </div>
                  {open.brief ? (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Brief</p>
                      <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-2.5 text-[12px] leading-relaxed dark:bg-slate-900">
                        {open.brief}
                      </p>
                    </div>
                  ) : null}
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Images de référence {open.refFiles.length ? `(${open.refFiles.length})` : ""}
                    </p>
                    {open.refFiles.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {open.refFiles.map((file) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={file}
                            src={libraryFileUrl(open.id, file)}
                            alt=""
                            className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-900/10"
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-slate-400">Aucune image de référence</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(open.prompt);
                        toast.success("Prompt copié");
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-[12px] font-medium dark:bg-slate-800"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copier le prompt
                    </button>
                    <button
                      type="button"
                      onClick={() => void reuse(open)}
                      className="inline-flex h-8 items-center rounded-lg bg-slate-900 px-2.5 text-[12px] font-medium text-white dark:bg-white dark:text-slate-900"
                    >
                      Réutiliser
                    </button>
                    <a
                      href={libraryFileUrl(open.id, open.resultFiles[0])}
                      download
                      className="inline-flex h-8 items-center rounded-lg bg-slate-100 px-2.5 text-[12px] font-medium dark:bg-slate-800"
                    >
                      Télécharger
                    </a>
                    <button
                      type="button"
                      onClick={() => void remove(open.id)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Supprimer
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture image impossible"));
    reader.readAsDataURL(blob);
  });
}
