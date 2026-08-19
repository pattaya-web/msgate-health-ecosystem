import { ProcessTabs } from "@/components/process/process-tabs";

export default function ProcessLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <ProcessTabs />
      {children}
    </div>
  );
}
