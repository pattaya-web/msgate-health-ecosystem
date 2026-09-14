import { HermesPageContextProvider } from "@/components/ask-hermes/page-context";
import { AppShell } from "@/components/layout/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <HermesPageContextProvider>
      <AppShell>{children}</AppShell>
    </HermesPageContextProvider>
  );
}
