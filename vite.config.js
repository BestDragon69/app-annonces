import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      // Toutes les requêtes qui commencent par /api seront redirigées vers ton backend
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
