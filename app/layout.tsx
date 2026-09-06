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
  title: "Nemvida Finance — Besplatne finansijske vesti i stručni članci",
  description:
    "Besplatne i otvorene finansijske vesti u realnom vremenu za Visa, Mastercard, American Express, Nvidia, Amazon, Meta, Alphabet, Microsoft, Merck, TSMC i Investor AB.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="sr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white dark:bg-black">
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
