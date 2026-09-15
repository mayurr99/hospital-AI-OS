import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "Hospital AI OS — Multi-hospital AI patient engagement & care automation",
  description:
    "Multi-tenant SaaS platform: AI receptionist, multilingual patient follow-up voice agents, clinical escalation, doctor CRM, hospital operations and enterprise administration.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
