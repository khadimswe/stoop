import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
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

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Stoop",
  description:
    "Stoop uses Qloo's taste data to map the audience around your product, then writes the scripts, hooks and AI-video prompts that culture would make.",
};

export const viewport: Viewport = {
  themeColor: "#fbf5ec",
  colorScheme: "light",
};

// Fonts and providers only. Each route group brings its own header: (marketing) the floating pill,
// (app) the 56 px top bar, so no page renders two.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${figtree.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
