import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { resolve } from "path";

export default defineConfig({
  plugins: [dts()],
  build: {
    lib: {
      entry: resolve(__dirname, "./src/index.ts"),
      name: "grower-js",
      fileName: "index",
      formats: ["es", "umd"],
    },
  },
})
