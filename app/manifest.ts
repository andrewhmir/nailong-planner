import type { MetadataRoute } from "next";
import { buildManifest } from "@/lib/pwa/manifest";

/** Next serves this route at `/manifest.webmanifest` and injects the link tag. */
export default function manifest(): MetadataRoute.Manifest {
  return buildManifest();
}
