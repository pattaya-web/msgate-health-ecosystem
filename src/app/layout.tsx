import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, TikTok_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/auth-context";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "./globals.css";

const appSans = Inter({
  variable: "--font-app-sans",
  subsets: ["latin"],
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
    { media: "(prefers-color-scheme: light)", color: "#f6faf8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
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
        className={`${appSans.variable} ${appMono.variable} ${tiktok.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <AuthProvider>
            {children}
            <Toaster richColors position="top-right" closeButton />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
