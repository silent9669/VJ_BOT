import { defineConfig, bindings } from "cf/config";

export default defineConfig({
  worker: {
    name: "vjbot",
    entrypoint: "src/worker.js",
    compatibilityDate: "2026-10-23",
    observability: {
      enabled: true
    },
    env: {
      DB: bindings.d1({
        id: "eb0d49a5-7a90-4219-968c-5fcb04390859"
      })
    }
  }
});
