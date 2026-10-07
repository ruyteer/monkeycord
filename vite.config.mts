import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Em dev, /api/join vai pro server.js (npm run dev:api)
  server: { proxy: { "/api": "http://localhost:3000" } },
});
