import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walk up from the calling module until a package.json is found. Works both from
 * the built `dist/` bundle and from `src/` under vitest, so bundled assets
 * (`examples/`, `templates/`) resolve to the installed package root.
 */
export function getPackageRoot(fromUrl: string = import.meta.url): string {
  const currentFile = fileURLToPath(fromUrl);
  let dir = path.dirname(currentFile);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  if (fs.existsSync(path.join(root, "package.json"))) {
    return root;
  }

  throw new Error("Cannot find package root. Reinstall prowl-tools.");
}
