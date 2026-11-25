import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: {
    default: "Nigeria State Monitor — National Intelligence",
    template: "%s · Nigeria State Monitor",
  },
  description:
    "AI-powered national intelligence, geospatial monitoring and economic intelligence for Nigeria. One map. Every state. A clearer picture of Nigeria.",
  applicationName: "Nigeria State Monitor",
  authors: [{ name: "Nigeria State Monitor" }],
  keywords: [
    "Nigeria",
    "situational awareness",
    "intelligence",
    "geospatial",
    "OSINT",
    "state monitor",
    "security",
    "economy",
  ],
  referrer: "origin-when-cross-origin",
  formatDetection: { telephone: false, address: false, email: false },
  openGraph: {
    title: "Nigeria State Monitor — National Intelligence",
    description: "One map. Every state. A clearer picture of Nigeria.",
    type: "website",
    locale: "en_NG",
    siteName: "Nigeria State Monitor",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#05070F",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
