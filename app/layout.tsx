import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { PWA_THEME_COLOR } from "@/lib/pwa/manifest";
import "./globals.css";

const lato = localFont({
  src: [
    { path: "./fonts/lato-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/lato-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-lato",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nailong Planner",
  description: "A private planner for two.",
  applicationName: "Nailong",
  // iOS has no install prompt: this metadata plus the manifest is what makes
  // Share → Add to Home Screen open as a standalone app on older iOS, and it
  // keeps the status bar white-on-rail (the shell paints under it).
  appleWebApp: {
    capable: true,
    title: "Nailong",
    statusBarStyle: "black-translucent",
  },
};

// `viewportFit: "cover"` is what makes env(safe-area-inset-*) non-zero in the
// installed app; without it every safe-area padding in the shell evaluates to 0.
// Never set maximumScale/userScalable — iOS inputs are fixed to 16px instead.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: PWA_THEME_COLOR,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={lato.variable}>
      <body>{children}</body>
    </html>
  );
}
