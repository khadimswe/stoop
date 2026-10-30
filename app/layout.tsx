import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { metadataOrigin } from "@/lib/marketing/site";
import "./globals.css";

// Display: Bricolage Grotesque with the width axis, set narrow in CSS (type-hero, type-h2).
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

// The floor's headlines (store-events app and landing): Source Serif 4, regular and medium only.
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Absolute OG and icon URLs: the configured site URL, else Vercel's production or deployment domain.
  metadataBase: metadataOrigin({
    app: process.env.NEXT_PUBLIC_APP_URL,
    production: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    deployment: process.env.VERCEL_URL,
  }),
  title: "Stoop",
  description: "Stoop plans a store event for your community: music your city plays, snacks from the spots nearby, a prize wheel, a poster and posts.",
};

export const viewport: Viewport = {
  themeColor: "#f1f0ed",
  colorScheme: "light",
};

// Fonts and providers only. Each route group brings its own header: (marketing) the floating pill,
// (app) the 56 px top bar, so no page renders two.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${figtree.variable} ${geistMono.variable} ${sourceSerif.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
