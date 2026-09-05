// Isolated UI fixture server. Never connects to Supabase or changes real dossiers.
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { technicianFixtureExpression } from "./helpers/mobile_browser_harness.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/__fixture.js") {
    const role = ["chef_atelier", "reception", "controle_qualite", "technicien"].includes(url.searchParams.get("role")) ? url.searchParams.get("role") : "technicien";
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`${technicianFixtureExpression({role})}.then(() => {
      state.cases[0].claims[0].estimate = { lines: [{phase:"mechanical", operation:"Remplacer les plaquettes avant", laborHours:1}] };
      if (${JSON.stringify(role)} !== "technicien") {
        state.cases[0].flags.workCompleted = true;
        state.bookings[0].status = "completed";
        state.bookings[0].remainingMinutes = 0;
        activeCaseId = state.cases[0].id;
        activeTab = "dossiers";
      }
      render();
      setActiveTab(activeTab);
      document.querySelectorAll(".local-lock-overlay").forEach(e => e.hidden = true);
      document.querySelector(".app-shell")?.removeAttribute("inert");
    }).catch(e => document.body.prepend(Object.assign(document.createElement('pre'), {textContent:e.stack})));`);
    return;
  }
  const file = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    let body = await fs.readFile(file);
    if (file.endsWith("index.html")) body = Buffer.from(body.toString()
      .replace(/<script[^>]*src="(?:https:[^"]*supabase[^" ]*|js\/supabase[^" ]*)"[^>]*><\/script>/g, "")
      .replace("</body>", `<script src="/__fixture.js?role=${encodeURIComponent(url.searchParams.get("role") || "technicien")}" defer></script></body>`));
    if (file === path.join(root, "app.js")) body = Buffer.from(body.toString()
      .replace(/initApp\(\);/, "/* fixture: startup bypassed */")
      .replace(/if \("serviceWorker" in navigator[\s\S]*$/, ""));
    res.writeHead(200, { "Content-Type": (mime[path.extname(file)] || "application/octet-stream") + "; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "connect-src 'self'; worker-src 'none'" });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
server.listen(8876, "127.0.0.1", () => console.log("Isolated operational preview: http://127.0.0.1:8876"));
