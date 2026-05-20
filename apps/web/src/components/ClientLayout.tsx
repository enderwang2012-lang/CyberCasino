"use client";

import { type ReactNode } from "react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <div className="relative">
        <div className="absolute top-[max(1.5rem,env(safe-area-inset-top))] right-5 z-30">
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </LanguageProvider>
  );
}
