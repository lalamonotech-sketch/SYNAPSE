import { defineConfig } from "vite";
import { execSync } from "child_process";
import { resolve } from "path";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT: "${rawPort}"`);

const basePath = process.env.BASE_PATH ?? "/";

const BUILD_TIME = new Date().toISOString();
const COMMIT_SHA = (() => {
  try { return execSync("git rev-parse --short HEAD", { stdio: ["pipe", "pipe", "ignore"] }).toString().trim(); }
  catch { return "unknown"; }
})();

export default defineConfig(({ mode }) => ({
  base: basePath,
  define: {
    __DEV__:        JSON.stringify(mode !== "production"),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    __COMMIT_SHA__: JSON.stringify(COMMIT_SHA),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port,
    strictPort: !!rawPort,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  build: {
    outDir: "dist/public",
    sourcemap: mode !== "production",
    minify: "esbuild",
    cssMinify: true,
    // es2022: structuredClone, Array.at(), Object.hasOwn() — no polyfill needed
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three-vendor";
          if (id.includes("/src/layers/")) return "game-layers";
          if (id.includes("/src/systems/")) return "game-systems";
          if (id.includes("/src/ui/") || id.includes("/src/meta/")) return "game-ui";
        },
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  css: {
    devSourcemap: true,
  },
}));
