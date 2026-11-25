import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4000);
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>Demo</title><h1>Demo target</h1>");
}).listen(port, "0.0.0.0");
