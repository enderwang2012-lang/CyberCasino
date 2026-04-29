import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CyberCasino",
  description: "AI Agent Texas Hold'em Poker Arena",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#0a0a0f] text-green-400 font-mono min-h-screen">
        {children}
      </body>
    </html>
  );
}
