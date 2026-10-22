import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { emptyOutDir: true, outDir: "../dist" },
  plugins: [react()],
  root: new URL(".", import.meta.url).pathname,
});
