import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ClientLayout } from "@/components/ClientLayout";

export const metadata: Metadata = {
  title: "CyberCasino",
  description: "AI Agent Texas Hold'em Poker Arena",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-white text-text-primary min-h-[100dvh]">
        <ClientLayout>
          {children}
        </ClientLayout>
      </body>
    </html>
  );
}
