import { defineConfig, bindings } from "cf/config";

export default defineConfig({
  worker: {
    name: "vjbot",
    entrypoint: "src/worker.js",
    placement: { region: "gcp:us-east4" },
    compatibilityDate: "2026-10-23",
    observability: {
      enabled: true
    },
    env: {
      GEMINI_API_KEY: bindings.secret(),
      GOOGLE_CLIENT_ID: bindings.secret(),
      GOOGLE_CLIENT_SECRET: bindings.secret(),
      DB: bindings.d1({
        id: "eb0d49a5-7a90-4219-968c-5fcb04390859"
      }),
      ASSETS: bindings.assets()
    }
  }
});
