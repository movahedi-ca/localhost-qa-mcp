/** Tiny static server for the fixture page. Serves 127.0.0.1 only. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    const html = await readFile(join(dir, "fixture.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  } else if (req.url === "/redirect-external") {
    // Trap for the interceptor test: a local URL that bounces outward.
    res.writeHead(302, { location: "https://example.com/" });
    res.end();
  } else {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

const port = Number(process.env.FIXTURE_PORT || 8931);
server.listen(port, "127.0.0.1", () => {
  console.log(`fixture on http://127.0.0.1:${port}/`);
});
