// ============================================================
// J.A.R.V.I.S — Express Server Wrapper
// Translates Express req/res into the Netlify handler format
// so jarvis.js needs zero changes
// ============================================================

const express = require("express");
const { handler, streamHandler } = require("./netlify/functions/jarvis");

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://jarvis-ai-arena.netlify.app";

app.use(express.json({ limit: "10mb" }));

// FIX 6: Health check endpoint.
// Any monitoring tool or curious employer can hit this URL to confirm
// the server is alive without doing a full query.
app.get("/api/jarvis/health", (req, res) => {
  res.json({ status: "ok", version: "v2.5", timestamp: new Date().toISOString() });
});

// ── Existing endpoint — untouched ─────────────────────────────
app.all("/api/jarvis", async (req, res) => {
  try {
    const event = {
      httpMethod: req.method,
      headers: req.headers,
      body: req.method === "OPTIONS" ? "" : JSON.stringify(req.body),
    };
    const result = await handler(event);
    res.status(result.statusCode);
    if (result.headers) {
      Object.entries(result.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }
    res.send(result.body);
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── SSE Stream endpoint — real-time agent progress ────────────
app.options("/api/jarvis/stream", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.status(204).end();
});

app.post("/api/jarvis/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.flushHeaders();

  const send = (eventName, data) => {
    if (!res.writableEnded) {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    await streamHandler(req.body, send);
  } catch (err) {
    console.error("Stream error:", err);
    send("error", { message: "Stream failed" });
  } finally {
    res.end();
  }
});

const server = app.listen(PORT, () => {
  console.log(`J.A.R.V.I.S backend running on port ${PORT}`);
});

// FIX 6: Graceful shutdown.
// When Railway restarts the server during a deploy, this tells it to
// finish any in-flight requests before shutting down instead of
// cutting them off mid-response.
process.on("SIGTERM", () => {
  console.log("SIGTERM received — shutting down gracefully");
  server.close(() => {
    console.log("J.A.R.V.I.S shutdown complete");
    process.exit(0);
  });
});
