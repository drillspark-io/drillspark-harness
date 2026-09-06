import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "業務の棚卸しシート", description: "普段の仕事と、かかっている時間を整理します。" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
