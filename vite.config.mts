import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // O chat e a sinalização da voz falam direto com o Worker (src/chat/store.ts; npm run dev:chat em dev).
  server: {
    // O wrangler grava o SQLite local em worker/.wrangler; sem isso o Vite recarrega a página a cada evento
    watch: { ignored: ["**/worker/**"] },
  },
});
