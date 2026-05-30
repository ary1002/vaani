// Minimal ambient declarations for the `ws` package (no @types/ws installed).
declare module "ws" {
  import { EventEmitter } from "events";

  interface WebSocketOptions {
    headers?: Record<string, string>;
  }

  type RawData = Buffer | ArrayBuffer | Buffer[];

  class WebSocket extends EventEmitter {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;

    readonly readyState: 0 | 1 | 2 | 3;

    constructor(url: string, options?: WebSocketOptions);

    send(data: Buffer | string): void;
    close(code?: number, reason?: string): void;

    on(event: "open", listener: () => void): this;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "message", listener: (data: RawData, isBinary: boolean) => void): this;

    once(event: "open", listener: () => void): this;
    once(event: "close", listener: (code: number, reason: Buffer) => void): this;
    once(event: "error", listener: (err: Error) => void): this;
    once(event: "message", listener: (data: RawData, isBinary: boolean) => void): this;

    removeListener(event: string, listener: (...args: unknown[]) => void): this;
  }

  export = WebSocket;
}
