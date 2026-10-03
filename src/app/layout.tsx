import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "다함께 이야기 · 생각이 만나 반짝이는 곳",
  description:
    "우리의 생각을 나누고, 이야기별과 함께 정리해요. 누구나 참여하는 따뜻한 토의와 토론 공간.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
