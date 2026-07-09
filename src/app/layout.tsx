import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { getPersonal } from "@/lib/data";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export function generateMetadata(): Metadata {
  const p = getPersonal();
  return {
    metadataBase: new URL("https://reidar.tech"),
    title: {
      default: `${p.name} | Project OS`,
      template: `%s | ${p.name}`,
    },
    description: p.bio,
    openGraph: {
      title: `${p.name} | Project OS`,
      description: p.bio,
      type: "website",
      url: "https://reidar.tech",
    },
    robots: { index: true, follow: true },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const p = getPersonal();
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[var(--surface)] text-[var(--text)]">
        <a href="#main-content" className="skip-link">Skip to content</a>
        <Header />
        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <Footer name={p.name} socials={p.socials} />
      </body>
    </html>
  );
}
