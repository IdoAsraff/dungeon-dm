import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev-server port and doesn't want the screen cleared.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/examples/**"] },
  },
  build: {
    target: "safari15",
    outDir: "dist",
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
