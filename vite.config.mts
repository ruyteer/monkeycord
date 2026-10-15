import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Em dev, /api/join vai pro server.js (npm run dev:api). O chat fala direto com o Worker (src/chat/store.ts).
  server: {
    proxy: { "/api": "http://localhost:3000" },
    // O wrangler grava o SQLite local em worker/.wrangler; sem isso o Vite recarrega a página a cada evento
    watch: { ignored: ["**/worker/**"] },
  },
});
