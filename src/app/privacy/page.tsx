import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · Mabillmafia",
  description: "How the Mabillmafia internal tool handles data from Meta.",
};

/**
 * Page publique exigée par Meta pour passer l'app « Mabillmafia » en mode
 * Live (URL de politique de confidentialité). L'outil est interne : il ne
 * sert qu'à piloter nos propres comptes publicitaires.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-[15px] leading-relaxed text-slate-800">
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Privacy Policy</h1>
      <p className="mb-8 text-sm text-slate-500">Last updated: November 13, 2026</p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Who we are</h2>
      <p>
        Mabillmafia is an internal business tool used by its owner to manage their own advertising accounts on
        Meta (Facebook and Instagram). It is not offered to the public and has no consumer users.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">What data we access</h2>
      <p>
        Through the Meta Marketing API, and only with the permissions granted by the Business Manager that owns
        the assets, the tool reads and manages ad accounts, campaigns, ad sets, ads, creatives, Pages and their
        performance metrics. We do not collect personal data about people who see or interact with the ads.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">How we use it</h2>
      <p>
        The data is used solely to create, upload and report on the owner&apos;s own advertising. It is never sold,
        shared with third parties or used for any other purpose.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Storage and retention</h2>
      <p>
        Reporting data is cached on our private server for as long as it is needed for reporting, and is deleted
        when the connection to Meta is removed.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Your choices</h2>
      <p>
        Access can be revoked at any time by removing the app from Business Settings → Integrations in Meta
        Business Manager. See our <a href="/data-deletion" className="underline">data deletion instructions</a>.
      </p>
    </main>
  );
}
