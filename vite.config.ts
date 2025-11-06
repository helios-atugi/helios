// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  // ★ GitHub Pages で必須（repo 名に合わせる）
  base: "/helios/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: true },
  build: {
    // 任意：ソースマップを出さない（配布物を軽量化）
    sourcemap: false,
  },
});
