const express = require("express");
const { subscribe } = require("../reactive/eventBus");

const router = express.Router();

router.get("/accidentes", (req, res) => {
  // Headers SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Mensaje inicial (útil para debugging)
  res.write(`event: hello\n`);
  res.write(`data: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);

  const unsubscribe = subscribe((event) => {
    // eventName opcional
    if (event.event) res.write(`event: ${event.event}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  });

  req.on("close", () => {
    unsubscribe();
    res.end();
  });
});

module.exports = { router };