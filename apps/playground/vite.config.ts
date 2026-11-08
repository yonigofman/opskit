import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // @opskit/ui is consumed from source, shadcn-style: its "@/components/ui/*" imports resolve here.
    alias: { "@": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)) },
  },
});
