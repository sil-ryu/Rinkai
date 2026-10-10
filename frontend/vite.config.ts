import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The frontend never calls third parties: everything goes through the backend at /api.
export default defineConfig({
  plugins: [react()],
  // satellite.js 7 ships an optional WASM build whose worker uses top-level await.
  worker: { format: "es" },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
