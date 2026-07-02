/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:5000";
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base,
  envDir: path.resolve(dirname, ".."),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  server: {
    allowedHosts: process.env.VITE_ALLOWED_HOSTS
      ? process.env.VITE_ALLOWED_HOSTS.split(",").map((host) => host.trim()).filter(Boolean)
      : undefined,
    proxy: {
      "/api": backendUrl,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: './src/test-setup.tsx',
  },
});
