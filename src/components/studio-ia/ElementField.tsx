"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Field } from "@/components/studio-ia/ui";
import type { ModelField } from "@/lib/models";
import { ThumbImg } from "@/components/studio-ia/MediaThumb";
import { takeFiles } from "@/lib/upload-client";

/**
 * Declaration d'un sujet a preserver, pour le champ `elements` de Kling Omni.
 *
 * Les modeles de transformation regenerent toute l'image : un petit objet tenu
 * en main perd ses details, faute de savoir a quoi il ressemble. `elements`
 * repond exactement a ce probleme — on nomme le sujet, on fournit ses photos,
 * et on le cite dans la consigne par `@nom`.
 */

export interface ElementValue {
  urls: string[];
  description: string;
}

export const EMPTY_ELEMENT: ElementValue = { urls: [], description: "" };

/** Nom du sujet, fixe : c'est lui qu'on cite dans la consigne. */
export const ELEMENT_NAME = "produit";

const MAX = 4;

export function ElementField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: ModelField;
  value: ElementValue;
  onChange: (v: ElementValue) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const urls = value?.urls ?? [];

  const upload = async (files: File[]) => {
    const batch = files.slice(0, Math.max(MAX - urls.length, 0));
    if (!batch.length) return;
    setError(null);
    setBusy((n) => n + batch.length);
    const added: string[] = [];
    for (const f of batch) {
      try {
        const form = new FormData();
        form.append("file", f, f.name);
        const res = await fetch("/api/kie/upload", { method: "POST", body: form });
        const body = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || body.error || !body.url) throw new Error(body.error ?? `Erreur ${res.status}`);
        added.push(body.url);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (added.length) onChange({ ...value, urls: [...urls, ...added] });
  };

  return (
    <Field label={field.label}>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 items-center flex-wrap">
          {urls.map((u, i) => (
            <span
              key={u + i}
              className="relative rounded-[8px] overflow-hidden shrink-0"
              style={{ width: 60, height: 60, background: "var(--surface-3)", border: "1px solid var(--border)" }}
            >
              <ThumbImg src={u} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onChange({ ...value, urls: urls.filter((_, j) => j !== i) })}
                title="Retirer"
                className="absolute top-0.5 right-0.5 grid place-items-center rounded-full text-[11px] leading-none"
                style={{ width: 17, height: 17, background: "rgb(0 0 0 / 0.62)", color: "#fff" }}
              >
                ×
              </button>
            </span>
          ))}

          {busy > 0 &&
            Array.from({ length: busy }).map((_, i) => (
              <span
                key={`b${i}`}
                className="rounded-[8px] grid place-items-center shrink-0"
                style={{ width: 60, height: 60, background: "var(--surface-3)" }}
              >
                <span className="spinner" />
              </span>
            ))}

          {urls.length < MAX && (
            <label
              className="rounded-[8px] flex flex-col items-center justify-center shrink-0"
              style={{
                width: 60,
                height: 60,
                border: "1px dashed var(--border-strong)",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              <span className="text-[16px] dim leading-none">+</span>
              <span className="dim text-[9.5px]">produit</span>
              <input
                type="file"
                hidden
                multiple
                accept="image/*,.jfif,.jpe,.heic,.heif,.avif"
                disabled={disabled}
                onChange={async (e) => {
                  const files = await takeFiles(e.currentTarget);
                  if (files.length) void upload(files);
                }}
              />
            </label>
          )}
        </div>

        <input
          className="input !text-[12.5px]"
          placeholder="Décris-le : « pot de crème blanc avec étiquette dorée »"
          value={value?.description ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />

        {urls.length > 0 && (
          <span className="dim text-[11px] leading-snug">
            Cite-le dans la consigne par <code className="mono">@{ELEMENT_NAME}</code> — c&apos;est ce qui dit au
            modèle de le rendre à l&apos;identique.
          </span>
        )}

        {error && (
          <span className="text-[11.5px]" style={{ color: "var(--critical)" }}>
            {error}
          </span>
        )}
      </div>
    </Field>
  );
}
