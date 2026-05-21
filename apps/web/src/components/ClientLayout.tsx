"use client";

import { type ReactNode } from "react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { HeaderProvider, useHeader } from "@/contexts/HeaderContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { UserMenu } from "@/components/UserMenu";

function HeaderBar() {
  const { visible } = useHeader();
  if (!visible) return null;
  return (
    <div className="absolute top-[max(1.5rem,env(safe-area-inset-top))] right-5 z-30 flex items-center gap-2">
      <UserMenu />
      <LanguageSwitcher />
    </div>
  );
}

export function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <AuthProvider>
        <HeaderProvider>
          <div className="relative">
            <HeaderBar />
            {children}
          </div>
        </HeaderProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}