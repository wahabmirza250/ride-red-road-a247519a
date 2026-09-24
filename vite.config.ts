// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { NitroConfig } from "nitro/types";

const nodeRuntime = {
  preset: "node-server",
  // Keep dependency tracing within the project on Windows build machines.
  traceOpts: { nft: { base: process.cwd() } },
} satisfies NitroConfig;

export default defineConfig({
  // Railway runs the application as a long-lived Node service. Lovable's
  // default Cloudflare Worker bundle only exports `fetch` and cannot listen on
  // Railway's assigned PORT, so production builds must use Nitro's Node preset.
  nitro: nodeRuntime,
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});

