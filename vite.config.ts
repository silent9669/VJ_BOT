import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({command}) => ({
  // Declare the test password only in the local dev runtime; production never requires it.
  plugins: [cloudflare({config:command === 'serve' ? config => ({env:{...config.env,LOCAL_TEST_ADMIN_PASSWORD:{type:'secret'}}}) : undefined})],
  publicDir: "static",
}));
