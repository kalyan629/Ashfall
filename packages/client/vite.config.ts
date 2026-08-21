import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    // Bind on all interfaces so a second device on the LAN can join the same
    // bunker. Testing multiplayer only ever in two tabs on one machine hides
    // every latency bug there is.
    host: true,
  },
  // @ashfall/shared ships raw TypeScript rather than a build artifact, so Vite
  // must be told to actually process it instead of treating it as a prebuilt
  // dependency.
  optimizeDeps: { exclude: ["@ashfall/shared"] },
});
