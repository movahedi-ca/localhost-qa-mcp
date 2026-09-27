/**
 * guard.js — localhost-only URL enforcement.
 *
 * This is the core safety boundary of localhost-qa-mcp: the browser may only
 * ever load pages served from the local machine. Everything else is rejected
 * before the browser sees it.
 *
 * Allowed:
 *   - http://localhost[:port]/..., http://127.0.0.1[:port]/..., http://[::1][:port]/...
 *   - any hostname that resolves (via the system resolver) to 127.0.0.1 or ::1
 *     (covers *.localhost, *.nip.io / *.sslip.io pointing at loopback, etc.)
 *   - file:// URLs (local files; the operator already has filesystem access)
 *
 * Blocked:
 *   - everything else, including credentials embedded in the URL,
 *     non-http(s) schemes (except file:), and unresolvable hosts.
 *
 * Two entry points:
 *   - assertLocalUrl(): strict check for top-level navigations requested via
 *     the `navigate` tool. data:/blob: are NOT allowed here (navigating to a
 *     data: URL is a classic XSS vector).
 *   - assertRequestUrl(): check used by the in-browser request interceptor
 *     (see browser.js). Same as above, but additionally allows data: and
 *     blob: subresources, which never touch the network.
 */
import { lookup } from "node:dns/promises";

const LOOPBACKS = new Set(["127.0.0.1", "::1"]);

/** Normalize a URL hostname: strip IPv6 brackets, unwrap ::ffff:v4. */
function normalizeHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped IPv6, dotted or compressed-hex form:
  // ::ffff:127.0.0.1 or ::ffff:7f00:1 -> 127.0.0.1
  let m = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return m[1];
  m = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) {
    const a = parseInt(m[1], 16);
    const b = parseInt(m[2], 16);
    return `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
  }
  return h;
}

/** Returns true if every resolved address of `host` is a loopback address. */
async function resolvesToLoopback(host) {
  let addrs;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return false;
  }
  return addrs.length > 0 && addrs.every((a) => LOOPBACKS.has(a.address));
}

async function check(raw, { allowInline = false } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Blocked: not a valid URL: ${raw}`);
  }

  if (url.protocol === "file:") return url;

  // Inline subresources never touch the network; allowed for requests only.
  if (allowInline && (url.protocol === "data:" || url.protocol === "blob:")) {
    return url;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Blocked: only http, https, and file URLs are allowed (got ${url.protocol})`
    );
  }

  if (url.username || url.password) {
    throw new Error("Blocked: URLs with embedded credentials are not allowed");
  }

  const host = normalizeHost(url.hostname);

  // Fast path for the common literals (WHATWG URL parsing already normalizes
  // hex/octal/decimal IPv4 forms like 0x7f.0.0.1 or 2130706433 to 127.0.0.1).
  if (host === "localhost" || LOOPBACKS.has(host)) return url;

  // Slow path: require the hostname to resolve exclusively to loopback.
  // Note the DNS-rebinding limitation documented in SECURITY.md.
  if (await resolvesToLoopback(host)) return url;

  throw new Error(
    `Blocked: ${url.hostname} does not resolve to loopback — this tool is localhost-only`
  );
}

/**
 * Strict check for top-level navigations (the `navigate` tool).
 * @returns the parsed URL on success, throws on block.
 */
export function assertLocalUrl(raw) {
  return check(raw, { allowInline: false });
}

/**
 * Check for the request interceptor: like assertLocalUrl, but data:/blob:
 * subresources are allowed (they never leave the machine).
 */
export function assertRequestUrl(raw) {
  return check(raw, { allowInline: true });
}
