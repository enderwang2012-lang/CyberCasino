"use client";

import { useEffect, useState, useRef } from "react";

interface TypewriterProps {
  text: string;
  cps?: number;
  className?: string;
}

export function Typewriter({ text, cps = 30, className }: TypewriterProps) {
  const [shown, setShown] = useState("");
  const keyRef = useRef(text);

  useEffect(() => {
    keyRef.current = text;
    setShown("");
    if (!text) return;
    const intervalMs = 1000 / cps;
    let i = 0;
    const t = setInterval(() => {
      i++;
      const current = keyRef.current;
      setShown(current.slice(0, i));
      if (i >= current.length) clearInterval(t);
    }, intervalMs);
    return () => clearInterval(t);
  }, [text, cps]);

  return <span data-testid="typewriter" className={className}>{shown}</span>;
}