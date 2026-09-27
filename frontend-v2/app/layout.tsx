import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { Titillium_Web } from "next/font/google";
import "./globals.css";

const titillium = Titillium_Web({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
  display: "swap",
  variable: "--font-titillium",
});

export const metadata: Metadata = {
  title: "GL Portal · Federal Bank",
  description: "AI-guided gold loan collateral verification for Federal Bank branches.",
};

export const viewport: Viewport = {
  themeColor: "#004E96",
  width: "device-width",
  initialScale: 1,
  // The bottom bar paints into the home-indicator area and pads itself with the safe inset.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={titillium.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
