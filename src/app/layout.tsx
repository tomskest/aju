import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "aju — memory for AI agents",
  description:
    "Open-source memory infrastructure for AI agents. CLI-first, MCP-compatible. Install with one line.",
  metadataBase: new URL("https://aju.sh"),
  openGraph: {
    title: "aju — memory for AI agents",
    description: "Open-source memory infrastructure for AI agents.",
    url: "https://aju.sh",
    siteName: "aju",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "aju — memory for AI agents",
    description: "Open-source memory infrastructure for AI agents.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
