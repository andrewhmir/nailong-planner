"use client";
import { assertOnline, requestJson, type ApiErrorBody } from "@/lib/query/request";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CollectionKind, CollectionRow, CollectionVisibility } from "@/lib/db/schema";
import type { CollectionNode } from "@/lib/services/collections";



export interface CollectionInput {
  name: string;
  parentId?: string | null;
  kind?: CollectionKind;
  hueFamily?: string;
  ownerId?: string | null;
  visibility?: CollectionVisibility;
}

export function useCollections() {
  return useQuery({
    queryKey: ["collections"],
    queryFn: async () =>
      (await requestJson<{ collections: CollectionNode[] }>("/api/collections")).collections,
  });
}

export function useCreateCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CollectionInput) =>
      requestJson<{ collection: CollectionRow }>("/api/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] }),
  });
}

export function useUpdateCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Partial<CollectionInput> & { sortOrder?: number }) =>
      requestJson<{ collection: CollectionRow }>(`/api/collections/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      // A rename/hue/visibility change is visible on the tree itself and in the
      // task rows' dots and calendar chips, so those caches are stale too.
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useDeleteCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      assertOnline();
      const response = await fetch(`/api/collections/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(payload?.error?.message ?? "Could not delete the calendar.");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      // The list's tasks are cascaded away with it.
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
