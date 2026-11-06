import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1967D2",
};

export const metadata: Metadata = {
  title: "Portal de Asistencia | Clínica de Simulación UCSUR",
  description: "Registro de asistencia para Docentes, Técnicos y Pacientes Simulados - Universidad Científica del Sur",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Asistencia UCSUR",
  },
  formatDetection: {
    telephone: false,
  },
};

import { Toaster } from "@/components/ui/sonner";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-[100dvh] flex flex-col selection:bg-blue-600 selection:text-white">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
