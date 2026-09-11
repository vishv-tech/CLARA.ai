import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "CLARA — College Learning and Resource Assistant",
  description: "A focused academic operating system for students.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={manrope.variable}>
      <body><AuthProvider><AuthenticatedShell>{children}</AuthenticatedShell></AuthProvider></body>
    </html>
  );
}
