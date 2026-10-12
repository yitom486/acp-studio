// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

/** Parse ICONDIR entries (width/height 0 = 256). */
function icoSizes(file: string): number[] {
  const b = fs.readFileSync(file);
  const n = b.readUInt16LE(4);
  return Array.from({ length: n }, (_, i) => b[6 + i * 16] || 256).sort((a, c) => a - c);
}

describe("app icons", () => {
  it("windows embeds the icon into the exe (rcedit runs) and points at a full ico", () => {
    // signAndEditExecutable:false skipped rcedit → exe/shortcut showed the Electron icon.
    expect(pkg.build.win.signAndEditExecutable).not.toBe(false);
    expect(pkg.build.win.icon).toBe("build/icon.ico");
    for (const k of ["installerIcon", "uninstallerIcon", "installerHeaderIcon"]) expect(pkg.build.nsis[k]).toBe("build/icon.ico");
    expect(icoSizes(path.join(root, "build/icon.ico"))).toEqual([16, 24, 32, 48, 64, 128, 256]);
    expect(icoSizes(path.join(root, "public/icon.ico"))).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });
  it("mac and linux icon sets exist", () => {
    expect(pkg.build.mac.icon).toBe("build/icon.icns");
    expect(fs.readFileSync(path.join(root, "build/icon.icns")).subarray(0, 4).toString()).toBe("icns");
    expect(pkg.build.linux.icon).toBe("build/icons");
    for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) {
      const b = fs.readFileSync(path.join(root, `build/icons/${s}x${s}.png`));
      expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([s, s]);
    }
  });
  it("web favicon + manifest", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    expect(html).toContain('href="/icon.ico"');
    expect(html).toContain('rel="manifest"');
    const m = JSON.parse(fs.readFileSync(path.join(root, "public/manifest.webmanifest"), "utf8"));
    for (const i of m.icons) expect(fs.existsSync(path.join(root, "public", i.src))).toBe(true);
  });
});
