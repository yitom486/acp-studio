// Bundle Electron main + preload for Node (Electron ships its own Node).
// Run: bun desktop/build.ts
// node-pty stays external: native .node can neither be bundled nor loaded
// from inside asar (see package.json#build files/asarUnpack).
const EXTERNAL = ["electron", "node-pty"];
const main = await Bun.build({
  entrypoints: ["desktop/main.ts"],
  target: "node",
  format: "cjs",
  minify: true,
  external: EXTERNAL,
  outdir: "electron-dist",
  naming: "main.cjs",
});
const preload = await Bun.build({
  entrypoints: ["desktop/preload.ts"],
  target: "node",
  format: "cjs",
  minify: true,
  external: ["electron"],
  outdir: "electron-dist",
  naming: "preload.cjs",
});
if (!main.success || !preload.success) {
  console.error("electron bundle failed");
  process.exit(1);
}
console.log("electron-dist/main.cjs + preload.cjs ready");
