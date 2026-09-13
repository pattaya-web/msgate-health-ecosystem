"use client";

import { useState, type FormEvent } from "react";

/**
 * Le formulaire de contact de la boutique.
 *
 * Il dépose le message côté serveur, où l'éditeur le lit : un souscripteur qui
 * le teste voit une confirmation, et le message existe vraiment. Si le dépôt
 * échoue, on ne laisse pas le client sans issue — le lien e-mail prend le
 * relais avec le texte déjà saisi.
 */
export function ContactForm({ slug, email }: { slug: string; email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ name: "", email: "", subject: "", message: "", website: "" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/ecom-sites/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Depuis l'aperçu de l'éditeur, le message est marqué comme un essai.
        body: JSON.stringify({ ...draft, slug, preview: typeof window !== "undefined" && window.self !== window.top }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || "Something went wrong.");
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="card p-6" data-contact-form="">
        <h2 className="text-[17px] font-bold">Thanks, your message is in.</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--muted)]">We reply within one business day, from {email}.</p>
        <button type="button" onClick={() => setState("idle")} className="btn-ghost mt-4 text-[13px]">
          Send another message
        </button>
      </div>
    );
  }

  const mailto = `mailto:${email}?subject=${encodeURIComponent(draft.subject || "Question")}&body=${encodeURIComponent(draft.message)}`;

  return (
    <form onSubmit={(event) => void submit(event)} className="card p-6" data-contact-form="">
      <h2 className="text-[17px] font-bold">Send us a message</h2>
      <p className="mt-1 text-[13px] text-[color:var(--muted)]">Fill in the form, we get back within one business day.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-[12px] font-semibold">
          Name
          <input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Your name" autoComplete="name" />
        </label>
        <label className="grid gap-1 text-[12px] font-semibold">
          Email
          <input required type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="you@example.com" autoComplete="email" />
        </label>
        <label className="grid gap-1 text-[12px] font-semibold sm:col-span-2">
          Subject
          <input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} placeholder="Order number, product question…" />
        </label>
        <label className="grid gap-1 text-[12px] font-semibold sm:col-span-2">
          Message
          <textarea required rows={5} value={draft.message} onChange={(event) => setDraft({ ...draft, message: event.target.value })} placeholder="How can we help?" />
        </label>
        {/* Champ piège pour les robots, invisible pour une personne. */}
        <input tabIndex={-1} autoComplete="off" value={draft.website} onChange={(event) => setDraft({ ...draft, website: event.target.value })} name="website" style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} aria-hidden="true" />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={state === "sending"} className="btn text-[14px]">
          {state === "sending" ? "Sending…" : "Send message"}
        </button>
        {state === "error" ? (
          <span className="text-[13px] text-[color:var(--muted)]">
            {error}{" "}
            <a href={mailto} className="font-semibold text-[color:var(--accent)] underline">
              Email us instead
            </a>
          </span>
        ) : null}
      </div>
    </form>
  );
}
