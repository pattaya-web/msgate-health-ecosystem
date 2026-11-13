import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Deletion · Mabillmafia",
  description: "How to delete data accessed by the Mabillmafia app.",
};

/** Page publique exigée par Meta (instructions de suppression des données). */
export default function DataDeletionPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-[15px] leading-relaxed text-slate-800">
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Data Deletion Instructions</h1>
      <p className="mb-8 text-sm text-slate-500">Last updated: November 13, 2026</p>

      <p>
        Mabillmafia does not store personal data about Facebook or Instagram users. It only keeps advertising
        reporting data for the business accounts that connected it.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">To remove the app and its data</h2>
      <ol className="list-decimal space-y-1 pl-6">
        <li>Open Meta Business Settings.</li>
        <li>Go to Integrations → Connected apps.</li>
        <li>Select Mabillmafia and click Remove.</li>
      </ol>
      <p className="mt-4">
        Removing the app revokes its access immediately. Any reporting data cached for those accounts is deleted
        from our server once the access is gone.
      </p>

      <p className="mt-6">
        See also our <a href="/privacy" className="underline">Privacy Policy</a>.
      </p>
    </main>
  );
}
