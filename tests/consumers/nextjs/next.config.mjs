import { fileURLToPath } from "node:url";

export default {
  reactStrictMode: true,
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
};
