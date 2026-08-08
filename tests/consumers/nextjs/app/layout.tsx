import type { ReactNode } from "react";
import { FonteRuntime } from "../components/fonte-runtime";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <FonteRuntime>{children}</FonteRuntime>
      </body>
    </html>
  );
}
