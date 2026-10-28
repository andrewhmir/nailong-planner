"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { OfflineSnapshotWriter } from "@/components/pwa/OfflineSnapshotWriter";
import { TOASTER_PROPS } from "@/components/ui/toast";

export function Providers({
  children,
  currentUserId,
}: {
  children: React.ReactNode;
  currentUserId: string;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            // An offline write must fail (and roll back) immediately, not pause
            // and replay later: the offline experience is explicitly read-only.
            networkMode: "always",
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <OfflineSnapshotWriter userId={currentUserId} />
      {children}
      <Toaster {...TOASTER_PROPS} />
    </QueryClientProvider>
  );
}
