import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "SAGE — Smart Agentic Guidance Engine",
  description: "A focused academic operating system for students.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={manrope.variable}>
      <body><div className="app-shell"><Sidebar /><main className="main-content">{children}</main></div></body>
    </html>
  );
}
