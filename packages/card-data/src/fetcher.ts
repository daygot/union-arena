// Polite HTTP fetcher with on-disk caching. Caches raw HTML so re-parsing is free and
// re-runs don't re-hit the server. Throttles requests to be a good citizen.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface FetcherOptions {
  cacheDir: string;
  /** Minimum ms between network requests. */
  throttleMs?: number;
  /** Re-use cached files newer than this many ms (default: forever). */
  maxAgeMs?: number;
}

export class Fetcher {
  private lastRequest = 0;
  constructor(private opts: FetcherOptions) {}

  private cachePath(key: string): string {
    const hash = createHash("sha1").update(key).digest("hex").slice(0, 16);
    return join(this.opts.cacheDir, `${hash}.html`);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async readCache(path: string): Promise<string | null> {
    try {
      if (this.opts.maxAgeMs !== undefined) {
        const s = await stat(path);
        if (Date.now() - s.mtimeMs > this.opts.maxAgeMs) return null;
      }
      return await readFile(path, "utf-8");
    } catch {
      return null;
    }
  }

  /** GET a URL (cache key = url). */
  async get(url: string): Promise<string> {
    return this.request("GET", url, undefined);
  }

  /** POST form-encoded body (cache key = url + body). */
  async postForm(url: string, form: Record<string, string>): Promise<string> {
    const body = new URLSearchParams(form).toString();
    return this.request("POST", url, body);
  }

  private async request(method: string, url: string, body?: string): Promise<string> {
    await mkdir(this.opts.cacheDir, { recursive: true });
    const key = `${method} ${url} ${body ?? ""}`;
    const path = this.cachePath(key);

    const cached = await this.readCache(path);
    if (cached !== null) return cached;

    // Throttle.
    const wait = (this.opts.throttleMs ?? 800) - (Date.now() - this.lastRequest);
    if (wait > 0) await this.sleep(wait);
    this.lastRequest = Date.now();

    const res = await fetch(url, {
      method,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(body ? { body } : {}),
    });
    if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status}`);
    const text = await res.text();
    await writeFile(path, text, "utf-8");
    return text;
  }
}
