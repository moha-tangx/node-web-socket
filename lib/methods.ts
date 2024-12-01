import { Socket } from "node:net";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

// return the parameters for the initial http handshake request
export function decodeRequest(message: string) {
  const response = message.split("\r\n\r\n")[0].split("\r\n");
  const method = response[0].split(" ")[0].toUpperCase(); //the request method
  const isHttp1 = /http\/1.1/gi.test(response[0]);
  const headers = Object.fromEntries(
    response
      .slice(1)
      .map((header) => header.split(": "))
      .map((pair) => [pair[0].toLowerCase(), pair[1]])
  );
  return {
    headers,
    method,
    isHttp1,
  };
}

//checks wether the http request is a valid websocket handshake
export function validateWebsocketRequest(request: {
  headers: { [key: string]: string };
  method: string;
  isHttp1: boolean;
}): [boolean, Error | null] {
  if (!request.isHttp1) {
    return [false, Error("only HTTP/1.1 allowed")];
  }

  if (request.method !== "GET") {
    return [false, Error("only GET method is allowed")];
  }

  const {
    upgrade,
    connection,
    "sec-websocket-key": client_key,
    "sec-websocket-version": version,
    // "sec-websocket-extensions": extensions,
  } = request.headers;
  //check all headers
  const IS_WEB_SOC_CON =
    connection === "Upgrade" &&
    upgrade === "websocket" &&
    version === "13" &&
    /^[a-zA-Z0-9/+]{22}==$/.test(client_key);

  if (!IS_WEB_SOC_CON)
    return [false, Error("only websocket connections allowed")];

  // passed all checks
  return [true, null];
}

// generates accept key
export function generate_accept_key(requestkey: string) {
  const ACCEPT_UUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  const plaintext = requestkey + ACCEPT_UUID;
  const hash = createHash("SHA1", { encoding: "base64" });
  return hash.update(plaintext).digest("base64");
}

//responds to the client with appropriate headers if it was a valid ws handshake request
export function shake(ACCEPT_KEY: string, socket: Socket) {
  const headers = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${ACCEPT_KEY}`,
    "",
  ]
    .map((line) => line.concat("\r\n"))
    .join("");
  socket.write(headers);
}

//prepares message to be sent to client in the appropriate websocket format
export function encodeMessage(final: boolean, opcode: number, data: Buffer) {
  const control = Buffer.alloc(2); //first two bytes of the frame
  const finbit = final ? 128 : 0; // set finbit if it's the last frame
  const firstByte = finbit + opcode; // set opcode
  const secondByte = data.length;
  control.writeUint8(firstByte, 0);
  control.writeUint8(secondByte, 1);
  return Buffer.concat([control, data]);
}

// get the "message length" from the client's message
export function getDataLength(message: Buffer) {
  const secondByte = message[1]; //mask and data length
  const indicator = secondByte - 128;
  if (indicator <= 125) return [0, indicator];
  if (indicator == 126) return [2, message[3] + message[4]];
  return [6, message.subarray(3, 11).reduce((p: number, c: number) => p + c)];
}

type decodedMessage = {
  final: boolean;
  opcode: number;
  dataLength: number;
  data: Uint8Array;
};

export function decodeMessage(
  message: Buffer
): [Error | null, decodedMessage | null] {
  const firstByte = message[0]; //finbit and opcode
  const secondByte = message[1]; //mask and data length

  if (secondByte < 128) return [Error("unmasked data"), null];

  const final = firstByte >= 128;
  const opcode = final ? firstByte - 128 : firstByte;
  const [extendedBytes, dataLength] = getDataLength(message);
  const data = message.subarray(extendedBytes + 6);
  const key = message.subarray(2 + extendedBytes, extendedBytes + 6);
  const unmasked = data.map((byte: number, i: number) => byte ^ key[i % 4]);
  return [
    null,
    {
      final,
      opcode,
      dataLength,
      data: unmasked,
    },
  ];
}
