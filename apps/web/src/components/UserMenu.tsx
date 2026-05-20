"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";

export function UserMenu() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[15px] text-text-secondary hover:text-text-primary transition-colors"
      >
        <img src={user.avatar} alt="" className="w-5 h-5 rounded-full" />
        <span className="max-w-[80px] truncate">{user.name}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] bg-white rounded-xl shadow-lg border border-separator py-1 min-w-[140px] z-50">
          <button
            onClick={() => { logout(); setOpen(false); }}
            className="w-full px-4 py-2.5 text-left text-[14px] text-danger hover:bg-surface-elevated transition-colors"
          >
            {t("auth.logout")}
          </button>
        </div>
      )}
    </div>
  );
}