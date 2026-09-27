# localhost-qa-mcp

A localhost-only headless browser MCP server for agent-driven QA.

Agents are good at writing UI code and bad at looking at it. This gives the
agent hands on a real headless Chrome for Testing: navigate local dev
servers, screenshot at mobile and desktop widths, click through interactions,
and assert a clean console with no failed requests — all as MCP tools.

## Why not just use an existing browser MCP?

Existing browser MCP servers (Chrome DevTools MCP, Playwright MCP) are
general-purpose: they will happily drive the browser anywhere on the public
web. This one is deliberately narrower:

- **Localhost-only, enforced in code** (`src/guard.js`). Only `localhost`,
  `127.0.0.1`, `::1`, hostnames resolving exclusively to loopback, and
  `file://` URLs load. Everything else is rejected before the browser sees
  it. No stealth mode, no fingerprint spoofing, no proxy support.
- **Zero browser download.** Uses an existing Chrome for Testing /
  Playwright Chromium binary instead of fetching one.
- **QA-shaped toolset.** Twelve tools covering the local QA loop and
  nothing else: navigate, snapshot, screenshot, viewport, click, fill,
  key press, wait, evaluate, console, network, close.

## Install

Node 18+ required.

```sh
git clone https://github.com/movahedi-ca/localhost-qa-mcp.git
cd localhost-qa-mcp
npm install
```

## Use

Stdio MCP server:

```sh
node src/server.js
```

`CHROME_PATH` overrides the Chrome binary location. Default:
`~/.cache/ms-playwright/chromium-1246/chrome-linux64/chrome`.

Claude Code config:

```json
{
  "mcpServers": {
    "localhost-qa": {
      "command": "node",
      "args": ["/path/to/localhost-qa-mcp/src/server.js"]
    }
  }
}
```

## Test

```sh
node test/run.js
```

24 assertions: every tool against a local fixture page (including its
deliberate console error and 404s), guard rejections for external URLs,
`0.0.0.0`, subdomain tricks, unresolvable hosts, embedded credentials, and
non-http schemes, plus interceptor tests proving server-side redirects and
`evaluate`-originated fetches to external hosts are blocked.

## Security

See [SECURITY.md](SECURITY.md). Short version: localhost-only is a code
guarantee, not a policy; `evaluate` runs page-context JS only; all browser
content is untrusted data, never instructions.

## License

MIT — see [LICENSE](LICENSE).
