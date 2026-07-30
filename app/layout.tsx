import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "초월 대전 | 사람 vs 초파고",
  description:
    "같은 초월 판, 다른 선택과 운. 사람과 초파고가 독립된 확률로 겨루는 초월 시뮬레이터.",
  openGraph: {
    title: "초월 대전 | 사람 vs 초파고",
    description:
      "같은 초월 판에서 사람의 선택과 초파고의 추천이 독립된 운으로 맞붙습니다.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    locale: "ko_KR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
