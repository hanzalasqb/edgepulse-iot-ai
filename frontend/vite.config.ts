import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          markdown: ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
  server: {
    proxy: { "/api": "http://localhost:8000", "/ws": { target: "ws://localhost:8000", ws: true } },
    
  },
});
