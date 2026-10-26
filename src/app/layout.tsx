import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SafeReply MTProto — Anti-Ban Telegram Userbot & VIP Auto-Reply",
  description:
    "Privacy-first, anti-ban Telegram MTProto Userbot engine for 24/7 DM Auto-Reply, Reply-Once enforcement, and Tanlangan Odamlar (VIP) contact segmentation.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased selection:bg-emerald-500/20 selection:text-emerald-400">
        {children}
      </body>
    </html>
  );
}
