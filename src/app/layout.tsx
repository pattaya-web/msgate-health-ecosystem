import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans, Instrument_Serif, TikTok_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/auth-context";
import { ThemeProvider } from "@/components/theme/theme-provider";
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
 * La vraie police des sous-titres TikTok. On ne charge que les deux graisses
 * réellement dessinées à l'écran et à l'export : demander une graisse qui n'est
 * pas servie la fait synthétiser en faux-gras baveux, ce qui est précisément le
 * rendu qu'on cherche à éviter.
 */
const tiktok = TikTok_Sans({
  variable: "--font-tiktok",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MSGate Health Ecosystem",
  description:
    "Operational health cockpit for ads, stats, ecosystem and process.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
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
