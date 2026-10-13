import * as fs from "node:fs";

/** Vite's default content hash is eight URL-safe characters. */
export function staticCacheControl(relativePath: string): string {
  return /^assets\/.+-[\w-]{8}\.[a-z\d]+$/i.test(relativePath.replace(/\\/g, "/"))
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

/** Conditional responses avoid reading/transferring unchanged files. */
export function staticFileResponse(req: Request, file: string, relativePath: string, contentType: string): Response {
  const stat = fs.statSync(file);
  // A weak validator describes this filesystem snapshot without hashing a
  // multi-megabyte bundle for every request. mtimeMs preserves subsecond edits.
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}-${stat.ctimeMs.toString(16)}"`;
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": staticCacheControl(relativePath),
    ETag: etag,
    "Last-Modified": stat.mtime.toUTCString(),
  };
  const ifNoneMatch = req.headers.get("If-None-Match");
  const modifiedSince = req.headers.get("If-Modified-Since");
  // If-None-Match takes precedence, including when no supplied tag matches.
  const unchanged = ifNoneMatch !== null
    ? ifNoneMatch.split(",").some((tag) => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""))
    : modifiedSince !== null && Math.floor(stat.mtimeMs / 1000) * 1000 <= Date.parse(modifiedSince);
  return new Response(unchanged || req.method === "HEAD" ? null : fs.readFileSync(file), {
    status: unchanged ? 304 : 200,
    headers,
  });
}
