import type { ReactNode } from "react";

export const runtime = "nodejs";

export default function RootLayout({ children }: { children: ReactNode }) {
  // Keep the host application's existing Fonte Website collector in its layout.
  // This reference does not install another collector or introduce a client key.
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
