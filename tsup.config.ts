import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/cli/index.ts",
    lib: "src/index.ts"
  },
  format: ["esm", "cjs"],
  sourcemap: true,
  dts: { entry: { lib: "src/index.ts" } },
  outDir: "dist",
  clean: true
});
