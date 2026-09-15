import AppShell from "@/components/AppShell";
import GuideBot from "@/components/GuideBot";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      {children}
      {/* Mitra sits above every screen in the workspace, not on the public pages. */}
      <GuideBot />
    </AppShell>
  );
}
