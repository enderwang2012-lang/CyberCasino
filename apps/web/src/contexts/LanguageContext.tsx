"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import zh from "@/locales/zh.json";
import en from "@/locales/en.json";

export type Language = "zh" | "en";

const translations: Record<Language, typeof zh> = { zh, en };

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

const STORAGE_KEY = "cybercasino-language";

function getNestedValue(obj: any, path: string): string | string[] | undefined {
  const keys = path.split(".");
  let current = obj;
  for (const key of keys) {
    if (current === undefined || current === null) return undefined;
    current = current[key];
  }
  return current;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("zh");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "zh" || stored === "en") {
      setLanguageState(stored);
    }
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    const value = getNestedValue(translations[language], key);
    if (value === undefined) {
      console.warn(`Translation missing: ${key}`);
      return key;
    }

    let result: string;
    if (Array.isArray(value)) {
      result = value.join("\n");
    } else {
      result = value;
    }

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      });
    }

    return result;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
