import type { ReactNode } from "react";

export const metadata = {
  title: "OpenVPM",
  description: "兽医诊所",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, color: "#111", background: "#fff" }}>{children}</body>
    </html>
  );
}
