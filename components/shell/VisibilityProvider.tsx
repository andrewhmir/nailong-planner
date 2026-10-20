"use client";

import { createContext, useContext } from "react";
import type { VisibilityApi } from "@/lib/ui/useVisibility";

const VisibilityContext = createContext<VisibilityApi | null>(null);

export function VisibilityProvider({
  value,
  children,
}: {
  value: VisibilityApi;
  children: React.ReactNode;
}) {
  return <VisibilityContext.Provider value={value}>{children}</VisibilityContext.Provider>;
}

export function useVisibilityApi(): VisibilityApi {
  const value = useContext(VisibilityContext);
  if (!value) {
    throw new Error("useVisibilityApi must be used inside VisibilityProvider");
  }
  return value;
}
