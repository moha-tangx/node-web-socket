import { Buffer } from "node:buffer";
import { WebsocketServer, Client } from "../lib/index.ts";

const socketServer = new WebsocketServer();

socketServer.on("handshake", (c: Client) => {
  console.log(
    "got a new websocket connection from",
    c.socket.remoteAddress,
    "🎉🎉🎉"
  );

  c.on("message", (message) => {
    console.log("got message:", message);
  });

  c.on("ping", (data: Buffer) => {
    console.log("client pinged:", data.toString("utf-8"));
  });

  c.on("pong", (data: Buffer) => {
    console.log("client ponged:", data.toString("utf-8"));
  });

  c.on("closed", (data: Buffer) => {
    console.log("client closed with message:", data.toString("utf-8"));
  });

  setTimeout(() => {
    c.ping("ping from server");
  }, 6000);

  setTimeout(() => {
    c.send("hello from server");
  }, 8000);

  setTimeout(() => {
    c.close("hello from server");
  }, 10000);
});

socketServer.listen(3000, () => {
  console.log("ws://localhost:3000");
});
