/**
 * run.js — end-to-end test: drives src/server.js over MCP stdio.
 *
 * Starts test/serve.js on 127.0.0.1, then exercises every tool and asserts:
 *  - local navigation works, snapshot/screenshot/click/fill/evaluate work
 *  - console + network capture the fixture's deliberate error/404s
 *  - the localhost guard rejects external URLs (example.com, 0.0.0.0,
 *    credentials-in-URL, non-http schemes)
 *
 * Usage: node test/run.js
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, "..");
const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}/`;

let passed = 0;
let failed = 0;
function ok(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

// ---- fixture server ----
const fixture = spawn("node", [join(dir, "serve.js")], {
  env: { ...process.env, FIXTURE_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((r) => fixture.stdout.once("data", r));

// ---- MCP client over stdio ----
const srv = spawn("node", [join(root, "src/server.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});
let buf = "";
const pending = new Map();
let nextId = 1;
srv.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
function rpc(method, params = {}) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
async function callTool(name, args = {}) {
  const res = await rpc("tools/call", { name, arguments: args });
  if (res.error) return { error: res.error };
  return res.result;
}
const textOf = (r) => r.content?.map((c) => c.text || "").join("\n") ?? "";

// handshake
await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "lqa-test", version: "0.1.0" },
});
srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

console.log("tools:");
const list = await rpc("tools/list");
const names = (list.result?.tools || []).map((t) => t.name);
ok("12 tools registered", names.length === 12, `got ${names.length}: ${names.join(",")}`);

console.log("happy path:");
let r = await callTool("navigate", { url: BASE });
ok("navigate local", !r.isError && textOf(r).includes("localhost-qa fixture"), textOf(r).slice(0, 120));

r = await callTool("snapshot");
ok("snapshot has heading", !r.isError && textOf(r).includes("Fixture page"), textOf(r).slice(0, 120));

r = await callTool("screenshot", { width: 390 });
ok("screenshot returns png", !r.isError && r.content?.[0]?.type === "image", JSON.stringify(r).slice(0, 120));

r = await callTool("click", { selector: "#btn" });
ok("click button", !r.isError, JSON.stringify(r).slice(0, 120));
r = await callTool("evaluate", { script: "document.getElementById('status').textContent" });
ok("click changed status", !r.isError && textOf(r).includes("clicked"), textOf(r).slice(0, 120));

r = await callTool("fill", { selector: "#name", value: "Ada" });
ok("fill input", !r.isError, JSON.stringify(r).slice(0, 120));
r = await callTool("evaluate", { script: "document.getElementById('name').value" });
ok("fill landed", !r.isError && textOf(r).includes("Ada"), textOf(r).slice(0, 120));

r = await callTool("console");
const consoleText = textOf(r);
ok("console captured deliberate error", consoleText.includes("fixture error"), consoleText.slice(0, 200));

r = await callTool("network");
const netText = textOf(r);
ok("network captured 404s", netText.includes("404"), netText.slice(0, 200));

r = await callTool("set_viewport", { width: 390, height: 844 });
ok("set_viewport", !r.isError && textOf(r).includes("390"), textOf(r).slice(0, 120));

console.log("guard (must all be rejected):");
const blocked = [
  ["external https", "https://example.com/"],
  ["external http", "http://example.com/"],
  ["zero addr", "http://0.0.0.0:8931/"],
  ["subdomain trick", "http://localhost.evil.com/"],
  ["unresolvable", "http://does-not-exist-xyz.invalid/"],
  ["credentials", "http://user:pass@127.0.0.1:8931/"],
  ["non-http scheme", "gopher://127.0.0.1:8931/"],
];
for (const [name, url] of blocked) {
  r = await callTool("navigate", { url });
  ok(`blocked: ${name}`, !!r.isError, `NOT BLOCKED: ${textOf(r).slice(0, 100)}`);
}
// file:// is allowed by policy — positive check against the real fixture
r = await callTool("navigate", { url: `file://${dir}/fixture.html` });
ok("file:// loads fixture", !r.isError && textOf(r).includes("localhost-qa fixture"), textOf(r).slice(0, 100));

console.log("interceptor (redirects + exfiltration must be stopped):");
r = await callTool("navigate", { url: `${BASE}redirect-external` });
const stayedLocal = !textOf(r).includes("example.com");
ok("server 302 to external is blocked", !!r.isError && stayedLocal, textOf(r).slice(0, 120));

// back to a good page, then try exfiltration from page JS
await callTool("navigate", { url: BASE });
r = await callTool("evaluate", { script: "fetch('https://example.com/').then(r=>r.status).catch(e=>'FETCH-BLOCKED:'+e.message)" });
ok("evaluate fetch to external is blocked", !r.isError && textOf(r).includes("FETCH-BLOCKED"), textOf(r).slice(0, 160));
r = await callTool("evaluate", { script: "location.href" });
ok("page never left localhost", !r.isError && textOf(r).includes("127.0.0.1"), textOf(r).slice(0, 100));

// guard unit checks (bracketed IPv6, mapped v4)
const guard = await import("../src/guard.js");
try {
  await guard.assertLocalUrl("http://[::1]:8931/");
  ok("guard allows [::1]", true);
} catch (e) {
  ok("guard allows [::1]", false, e.message);
}
try {
  await guard.assertLocalUrl("http://[::ffff:127.0.0.1]:8931/");
  ok("guard allows [::ffff:127.0.0.1]", true);
} catch (e) {
  ok("guard allows [::ffff:127.0.0.1]", false, e.message);
}

await callTool("close");
srv.kill();
fixture.kill();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
