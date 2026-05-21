"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface HeaderContextType {
  visible: boolean;
  setVisible: (v: boolean) => void;
}

const HeaderContext = createContext<HeaderContextType>({ visible: true, setVisible: () => {} });

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  return (
    <HeaderContext.Provider value={{ visible, setVisible }}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeader() {
  return useContext(HeaderContext);
}