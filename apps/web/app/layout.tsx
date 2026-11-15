import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/lib/providers";

export const metadata: Metadata = {
  title: "OpenVPM",
  description: "Veterinary practice workspace",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
