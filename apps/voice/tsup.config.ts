import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", doctor: "src/doctor.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace packages are TypeScript sources – bundle them; keep npm dependencies external.
  skipNodeModulesBundle: true,
  noExternal: [/^@justcall\//],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
