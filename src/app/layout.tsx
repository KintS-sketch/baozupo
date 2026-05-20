import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { UserProvider } from "@/contexts/user-context";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "养房 Tend · AI 房东助手",
  description: "拍一下就出账单，到期主动提醒",
  manifest: "/manifest.json",
  applicationName: "养房 Tend",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "养房",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      { url: "/icon-180.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/icon.svg"],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#C8553D",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <UserProvider>
          <div className="flex min-h-screen bg-background">
            <Sidebar />
            <main className="flex-1 min-w-0 main-content">
              {children}
            </main>
          </div>
          <MobileNav />
        </UserProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
