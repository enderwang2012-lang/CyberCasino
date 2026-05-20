"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export interface AuthUser {
  userId: string;
  name: string;
  avatar: string;
  provider: string;
}

type MeResponse = { authenticated: false } | ({ authenticated: true } & AuthUser);

interface AuthContextType {
  loading: boolean;
  user: AuthUser | null;
  login: (provider: "github" | "google") => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: MeResponse) => {
        if (data.authenticated) {
          setUser({ userId: data.userId, name: data.name, avatar: data.avatar, provider: data.provider });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const login = useCallback((provider: "github" | "google") => {
    window.location.href = `/api/auth/login?provider=${provider}`;
  }, []);

  const logout = useCallback(() => {
    fetch("/api/auth/logout", { method: "POST" }).finally(() => {
      setUser(null);
    });
  }, []);

  return (
    <AuthContext.Provider value={{ loading, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}