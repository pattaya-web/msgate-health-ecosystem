import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans, Instrument_Serif, TikTok_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/auth-context";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { UpdateBar } from "@/components/layout/update-bar";
import "./globals.css";

/**
 * Qoves compose avec PP Neue Montreal (texte), F37 Zagma (libellés) et Denton
 * (titres). Ce sont des fontes commerciales : on prend leurs cousines libres
 * les plus proches — Instrument Sans pour le grotesque, Instrument Serif pour
 * les titres, Geist Mono pour les petits libellés techniques.
 */
const appSans = Instrument_Sans({
  variable: "--font-app-sans",
  subsets: ["latin"],
  display: "swap",
});

const appDisplay = Instrument_Serif({
  variable: "--font-app-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const appMono = Geist_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
  display: "swap",
});

/**
 * La vraie police des sous-titres TikTok, chargée en police variable : un seul
 * fichier porte toutes les vraies graisses (300 à 900), donc 600 et 700 sont
 * dessinés, jamais synthétisés en faux-gras.
 *
 * Ne pas revenir à `weight: ["600", "700"]` : Google sert désormais le même
 * fichier pour les deux graisses, et Turbopack refuse ce doublon (« next/font/
 * google queries have exactly one entry »), ce qui fait tomber toutes les pages
 * en 500 dès que le cache .next est vidé.
 */
const tiktok = TikTok_Sans({
  variable: "--font-tiktok",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MSGate Health Ecosystem",
  description:
    "Operational health cockpit for ads, stats, ecosystem and process.",
  applicationName: "MSGate",
  /*
   * Ajouté à l'écran d'accueil de l'iPhone, l'outil s'ouvre en plein écran.
   * Barre d'état « default » : opaque, l'heure et la batterie restent lisibles
   * sur le fond clair comme sur le sombre (« black-translucent » écrirait en
   * blanc par-dessus le papier clair). Les marges env(safe-area-inset-*) de
   * l'en-tête et de la barre du bas suivent quand même l'encoche en paysage.
   */
  appleWebApp: {
    capable: true,
    title: "MSGate",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  // Next n'écrit plus que « mobile-web-app-capable » : on garde l'ancienne balise Apple pour les iOS plus anciens.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Le contenu va jusqu'aux bords (encoche, barre d'accueil) : les zones sûres sont gérées en CSS.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fbfb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1315" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${appSans.variable} ${appDisplay.variable} ${appMono.variable} ${tiktok.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <AuthProvider>
            <UpdateBar />
            {children}
            <Toaster
              position="top-right"
              closeButton
              toastOptions={{
                classNames: {
                  toast:
                    "!rounded-2xl !border-slate-200 !bg-white !text-slate-900 !shadow-[0_18px_48px_-18px_rgba(11,19,21,0.35)] dark:!border-slate-800 dark:!bg-slate-950 dark:!text-slate-100",
                  description: "!text-slate-500",
                },
              }}
            />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
