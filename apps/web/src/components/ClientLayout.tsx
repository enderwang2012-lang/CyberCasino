"use client";

import { type ReactNode } from "react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { UserMenu } from "@/components/UserMenu";

export function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <AuthProvider>
        <div className="relative">
          <div className="absolute top-[max(1.5rem,env(safe-area-inset-top))] right-5 z-30 flex items-center gap-2">
            <UserMenu />
            <LanguageSwitcher />
          </div>
          {children}
        </div>
      </AuthProvider>
    </LanguageProvider>
  );
}