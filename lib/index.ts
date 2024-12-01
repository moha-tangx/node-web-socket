import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { Socket, Server, createServer } from "node:net";
import {
  shake,
  decodeMessage,
  decodeRequest,
  encodeMessage,
  generate_accept_key,
  validateWebsocketRequest,
} from "./methods.ts";

type ServerOpts = {
  allowHalfOpen?: boolean | undefined;
  pauseOnConnect?: boolean | undefined;
  noDelay?: boolean | undefined;
  keepAlive?: boolean | undefined;
  keepAliveInitialDelay?: number | undefined;
};

/**
 * this is an abstraction created on top of the net {@link Socket}
 * A Client can be created by the user and used directly to interact with a server.
 */
export class Client extends EventEmitter {
  socket: Socket;
  prev_type = 0;
  frames: Uint8Array[] = [];

  constructor(rootSocket: Socket) {
    super();
    this.socket = rootSocket ?? new Socket();
  }

  send(message: string | Buffer) {
    const opcode = Buffer.isBuffer(message) ? 2 : 1;
    message = encodeMessage(true, opcode, Buffer.from(message));
    if (this.socket.writable) this.socket.write(message);
  }

  close(message: string | Buffer) {
    message = Buffer.from(message);
    message = encodeMessage(true, 8, Buffer.from(message));
    if (this.socket.writable) this.socket.write(message);
  }

  ping(message: string | Buffer) {
    message = Buffer.from(message);
    message = encodeMessage(true, 9, Buffer.from(message));
    if (this.socket.writable) this.socket.write(message);
  }

  pong(message: string | Buffer) {
    message = Buffer.from(message);
    message = encodeMessage(true, 10, Buffer.from(message));
    if (this.socket.writable) this.socket.write(message);
  }
}

/**
 * the {@link WebsocketServer} class instantiates a new websocket server
 *
 * @example
 * ```js
 * const server = new WebsocketServer();
 *
 * server.on("handshake",(client)=>{
 *    client.send("hello from server!")
 * });
 *
 * server.listen(3000);
 * ```
 * @since v 1.0.0
 */
export class WebsocketServer extends EventEmitter {
  rootServer: Server;

  constructor(options?: ServerOpts) {
    super();
    instantiateServer.call(this, options);
  }

  listen(port: number, listener?: () => void) {
    this.rootServer.listen(port, listener);
  }
}

function instantiateServer(this: WebsocketServer, options: ServerOpts) {
  const server = createServer(options);
  this.rootServer = server;

  this.rootServer.on("connection", (socket: Socket) => {
    // handle connection closing, ending and error
    handleHandShake.call(this, socket);

    ["error", "close", "end"].forEach((event) => {
      socket.on(event, (reason: Error) => {
        socket.destroy(reason);
      });
    });
  });
  return this.rootServer;
}

function handleHandShake(this: WebsocketServer, socket: Socket) {
  socket.once("data", (data: Buffer) => {
    const request = decodeRequest(data.toString()); // decodes data as a http request
    const [validWebSocReq, err] = validateWebsocketRequest(request);

    // close connection if it is not valid WebSocket connection
    if (!validWebSocReq) {
      socket.write(
        "HTTP/1.1 400 Bad Request \r\n\r\n only web sockets allowed\n"
      );
      return err && socket.destroy(err);
    }

    const client_key = request.headers["sec-websocket-key"];
    const ACCEPT_KEY = generate_accept_key(client_key);
    shake(ACCEPT_KEY, socket);

    const client = new Client(socket);
    this.emit("handshake", client);
    handleMessage.call(client);
  });
}

function handleMessage(this: Client) {
  this.socket.on("data", (data) => {
    const [decodeError, decoded] = decodeMessage(data);

    if (decodeError || !decoded) return this.emit("close", decodeError);

    const { data: current_frame, opcode, final } = decoded;

    //if client requests close
    if (opcode == 8) return this.emit("close", current_frame);

    // if client pings...we pong...
    if (opcode == 9) return this.emit("ping", current_frame);

    // if client pongs.. its alive
    if (opcode == 10) return this.emit("pong", current_frame);

    // set the previous (perharps current) type if it is the first frame
    if (!this.frames.length) this.prev_type = opcode;

    /**
     * if it is not the first frame and data type is not the same as previous then its is not a valid frame.
     */
    if (this.frames.length && (opcode !== 0 || opcode !== this.prev_type))
      this.emit("close", "invalid frame");

    //if fragments are on the way...
    if (!final) this.frames.push(current_frame);

    // if fragments are complete
    if (final) {
      this.frames.push(current_frame);
      const message = Buffer.concat(this.frames);
      // empty the buffer after getting the final frame
      this.frames.length = 0;

      // parse message to utf-8 string if opcode is "1" else pass the raw buffer
      if (opcode == 1) this.emit("message", message.toString("utf-8"));
      else this.emit("message", message);
    }
  });
}
