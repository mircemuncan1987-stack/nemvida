import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nemvida Finance — Besplatne finansijske vesti i alati za analizu akcija",
  description:
    "Besplatne finansijske vesti u realnom vremenu uz besplatne alate za analizu akcija: pregled kompanije, poređenje tikera, skener S&P 500/Dow/Nasdaq-100 i evropskih indeksa, praćenje sopstvenog portfelja i Fišerovih 15 pitanja za najveće S&P 500 kompanije.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="sr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
