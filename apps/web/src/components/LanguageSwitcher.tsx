"use client";

import { useLanguage } from "@/contexts/LanguageContext";

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <button
      onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
      className="text-text-secondary hover:text-text-primary text-[14px] font-medium transition-colors"
    >
      {language === "zh" ? "EN" : "中"}
    </button>
  );
}
