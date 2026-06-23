const express = require("express");
const cors    = require("cors");
const cron    = require("node-cron");
const path    = require("path");
const http    = require("http");
const { initSchema } = require("./db/schema");
const routes  = require("./routes");
const { syncAll } = require("./services/smogonSync");
const { startTournamentScheduler } = require("./services/tournamentScheduler");
const { attachRoomServer } = require("./realtime/roomServer");
const { ensureSchema } = require("./tournament/store");
const { sweepStale } = require("./tournament/service");
const { attachTournamentRealtime } = require("./tournament/realtime");

const app  = express();
const PORT = process.env.PORT ?? 3001;
// Prod: set CLIENT_ORIGINS="https://yourdomain.com" (comma-separated for several).
// Dev: defaults to the local Vite ports.
const CLIENT_ORIGINS = process.env.CLIENT_ORIGINS
  ? process.env.CLIENT_ORIGINS.split(",").map(s => s.trim()).filter(Boolean)
  : ["http://localhost:5173", "http://localhost:5174"];

app.use(cors({ origin: CLIENT_ORIGINS }));
app.use(express.json());

// Serve locally-cached sprites — avoids 300 simultaneous CDN requests in the browser
app.use('/sprites', express.static(path.join(__dirname, '../public/sprites'), {
  maxAge: '30d',         // tell the browser to cache aggressively
  immutable: true,
}));

app.use("/api", routes);

async function start() {
  await initSchema();
  console.log("[app] SQLite schema ready");

  console.log("[app] Running startup sync (Smogon + Showdown sources only)...");
  await syncAll();


  // Monthly Smogon/Showdown refresh: 2nd of each month at 06:00
  cron.schedule("0 6 2 * *", async () => {
    console.log("[cron] Monthly sync triggered");
    await syncAll();
  });

  // Daily tournament sync at 00:05 UTC (with startup catch-up if server was down)
  const db = await (require("./db/schema").getDb)();
  await startTournamentScheduler(db);

  // Live tournament subsystem: ensure tables exist, then sweep inactive events daily.
  ensureSchema(db);
  cron.schedule("0 3 * * *", () => {
    try {
      const { abandoned } = sweepStale(db);
      if (abandoned.length)
        console.log(`[cron] Swept ${abandoned.length} stale tournament(s): ${abandoned.join(", ")}`);
    } catch (e) { console.error("[cron] tournament sweep error:", e.message); }
  });

  // Multiplayer game rooms (Socket.IO) share the same HTTP server.
  // In prod, nginx already proxies the WebSocket upgrade on /api/.
  const server = http.createServer(app);
  const io = attachRoomServer(server, { path: "/api/socket.io", origins: CLIENT_ORIGINS });
  attachTournamentRealtime(io); // live tournament updates share the same Socket.IO server

  server.listen(PORT, () => console.log(`[app] Running on http://localhost:${PORT}`));
}

start().catch(err => { console.error("[app] Fatal:", err); process.exit(1); });
