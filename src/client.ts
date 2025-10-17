import net from "net"
import tls from "tls"
import { EventEmitter } from "events"
import { Stream } from "yamux-js"
import {
  Header,
  Request,
  MessageType,
  ProtoType,
  StatusCode,
  HEADER_SIZE,
  serializeHeader,
  deserializeHeader,
  serializeRequest,
  deserializeResponse,
  deserializeMetrics,
  FLAG_METRICS,
} from "./proto/proto.js"
import { defaultConfig } from "yamux-js/lib/mux.js"
import { Duplex } from "stream"
import { Session } from "yamux-js/lib/session.js"
import { renderMetrics } from "./metrics.js"

export interface ClientOptions {
  addr: string
  targetAddr: string
  withTLS?: boolean
  proto: ProtoType
  name: string
  metrics?: boolean
}

export interface MetricsData {
  ingress: bigint
  egress: bigint
  uptime: bigint
  connectionCount: bigint
  activeConnections: number
}

export class Client {
  private addr: string
  private targetAddr: string
  private withTLS: boolean
  private proto: ProtoType
  private name: string
  private domain: string = ""
  private metrics: boolean
  private session: Session | null = null
  private eventEmitter: EventEmitter

  constructor(options: ClientOptions) {
    this.eventEmitter = new EventEmitter()

    if (!options.addr) {
      throw new Error("addr must be set")
    }
    if (!options.targetAddr) {
      throw new Error("targetAddr must be set")
    }
    if (!options.name) {
      throw new Error("name must be set")
    }
    if (!options.proto) {
      throw new Error("proto must be set")
    }

    this.addr = options.addr
    this.targetAddr = options.targetAddr
    this.withTLS = options.withTLS ?? false
    this.proto = options.proto
    this.name = options.name
    this.metrics = options.metrics ?? false
  }

  on(event: string, listener: (...args: any[]) => void) {
    this.eventEmitter.on(event, listener)
    return this
  }

  once(event: string, listener: (...args: any[]) => void) {
    this.eventEmitter.once(event, listener)
    return this
  }

  off(event: string, listener: (...args: any[]) => void) {
    this.eventEmitter.off(event, listener)
    return this
  }

  private emit(event: string, ...args: any[]) {
    this.eventEmitter.emit(event, ...args)
  }

  async run(abort: AbortController): Promise<void> {
    const [host, port] = this.addr.split(":")

    const tlsOptions: tls.ConnectionOptions = {
      host,
      port: Number(port),
      servername: host,
    }

    return new Promise((resolve, reject) => {
      const conn = tls.connect(tlsOptions, async () => {
        try {
          await this.handleConnection(abort, conn)
          resolve()
        } catch (err) {
          reject(err)
        }
      })

      conn.on("error", (err) => {
        reject(new Error(`failed to dial server: ${err.message}`))
      })

      abort.signal.addEventListener("abort", () => {
        conn.destroy()
        reject()
      })
    })
  }

  private async sendRequest(stream: Stream): Promise<Header> {
    const request = new Request(this.proto, this.name)
    const serializedRequest = serializeRequest(request)

    const header = new Header(MessageType.Request, BigInt(serializedRequest.length))
    if (this.metrics) {
      header.setFlag(FLAG_METRICS)
    }

    const serializedHeader = serializeHeader(header)

    stream.write(serializedHeader)
    stream.write(serializedRequest)

    const headerBuf = await this.readN(stream, HEADER_SIZE)

    return deserializeHeader(headerBuf)
  }

  private async handleConnection(abort: AbortController, conn: net.Socket | tls.TLSSocket): Promise<void> {
    const yamuxConfig = defaultConfig
    yamuxConfig.keepAliveInterval = 1000
    yamuxConfig.enableKeepAlive = true
    yamuxConfig.acceptBacklog = 1000

    this.session = new Session(true, yamuxConfig, (stream: Duplex) => {
      this.onNewStream(stream as Stream).catch(err => {
        console.error("failed to handle stream:", err)
      })
    })

    this.session.pipe(conn).pipe(this.session)

    const stream = this.session.open()
    const responseHeader = await this.sendRequest(stream)

    if (responseHeader.type === MessageType.Error) {
      const errorBuf = await this.readN(stream, Number(responseHeader.length))
      throw new Error(`server error: ${errorBuf.toString("utf8")}`)
    }

    if (responseHeader.type !== MessageType.Response) {
      throw new Error(`unexpected header type: ${responseHeader.type}`)
    }

    const responseBuf = await this.readN(stream, Number(responseHeader.length))
    const response = deserializeResponse(responseBuf)

    switch (response.status) {
      case StatusCode.NameTaken:
        prettyPrint("err", `subdomain '${this.name}' is already in use`)
        return
      case StatusCode.UnsupportedProto:
        prettyPrint("err", `protocol '${this.proto}' is not supported`)
        return
      case StatusCode.OK:
        break
      default:
        prettyPrint("err", `unexpected response status: ${response.status}`)
        throw new Error(`unexpected response status: ${response.status}`)
    }

    this.domain = response.domain
    const expiresAt = new Date(Date.now() + Number(response.ttlHours) / 1_000_000)

    prettyPrint(
      "inf",
      "tunnel created!",
      `${protoString(this.proto)}${response.domain}`,
      `tunnel expires at ${expiresAt.toLocaleString()}`
    )

    if (this.metrics) {
      renderMetrics(abort.signal, this)
    }

    return new Promise((resolve, reject) => {
      this.session!.on("close", () => {
        abort.abort()
        resolve()
      })
      this.session!.on("error", (err: Error) => {
        reject(err)
      })
    })
  }

  private async onNewStream(stream: Stream): Promise<void> {
    try {
      const headerBuf = await this.readN(stream, HEADER_SIZE)
      const header = deserializeHeader(headerBuf)

      switch (header.type) {
        case MessageType.Access:
          this.handleAccess(stream).catch((err) => {
            console.error("failed to handle access:", err)
          })
          break

        case MessageType.Metrics:
          this.handleMetrics(header, stream)
          break

        case MessageType.End:
          stream.close()
          prettyPrint("inf", "tunnel timed out")
          this.session?.close()
          break

        default:
          console.debug(`unexpected header type: ${header.type}`)
          stream.close()
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("EOF") || err.message.includes("closed"))
      ) {
        console.debug("stream connection closed")
      } else {
        console.error("failed to read stream header:", err)
      }
      stream.close()
    }
  }

  private async handleAccess(stream: Stream): Promise<void> {
    await this.sendAck(stream)
    await this.forwardStream(stream)
    stream.close()
  }

  private async forwardStream(stream: Stream): Promise<void> {
    const [host, port] = this.targetAddr.split(":")

    return new Promise((resolve, reject) => {
      let localConn: net.Socket | tls.TLSSocket
      let isCleanedUp = false

      if (this.withTLS) {
        localConn = tls.connect({
          host,
          port: Number(port),
          rejectUnauthorized: false
        })
      } else {
        localConn = net.connect({ host, port: Number(port) })
      }

      const cleanup = (err?: Error) => {
        if (isCleanedUp) return
        isCleanedUp = true

        if (typeof (stream as Stream).close === "function") {
          // BUG: Stream is not being closed right away (about 5-6 seconds)
          // this will result to acceptBacklog being exceeded,
          // which will force a connection reset
          // keeping yamuxConfig.acceptBacklog big will do for now
          (stream as Stream).close()
        } else {
          stream.end()
        }

        if (err) reject(err)
        else resolve()
      }

      localConn.once("connect", () => {
        stream.pipe(localConn)
        localConn.pipe(stream)
      })

      stream.once("close", () => cleanup())
      stream.once("end", () => cleanup())
      stream.once("error", cleanup)

      localConn.once("close", () => cleanup())
      localConn.once("end", () => cleanup())
      localConn.once("error", cleanup)
    })
  }

  private async handleMetrics(header: Header, stream: Stream): Promise<void> {
    try {
      const metricsBuf = await this.readN(stream, Number(header.length))
      const metrics = deserializeMetrics(metricsBuf)

      this.emit("metrics", {
        ingress: metrics.ingress,
        egress: metrics.egress,
        uptime: metrics.uptime,
        connectionCount: metrics.connectionCount,
        activeConnections: metrics.activeConnections,
      })

      while (true) {
        const headerBuf = await this.readN(stream, HEADER_SIZE)
        const h = deserializeHeader(headerBuf)

        const metricsBuf = await this.readN(stream, Number(h.length))
        const metrics = deserializeMetrics(metricsBuf)

        this.emit("metrics", {
          ingress: metrics.ingress,
          egress: metrics.egress,
          uptime: metrics.uptime,
          connectionCount: metrics.connectionCount,
          activeConnections: metrics.activeConnections,
        })
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("EOF") || err.message.includes("closed"))
      ) {
        return
      }
    } finally {
      stream.close()
    }
  }

  private async sendAck(stream: Duplex): Promise<void> {
    const header = new Header(MessageType.Ack, 0n)
    const serializedHeader = serializeHeader(header)
    stream.write(serializedHeader)
  }

  private async readN(stream: NodeJS.ReadableStream, n: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let buf = Buffer.alloc(0);

      const onReadable = () => {
        let chunk;
        while ((chunk = stream.read(n - buf.length)) !== null) {
          buf = Buffer.concat([buf, chunk as Uint8Array]);
          if (buf.length === n) {
            cleanup();
            resolve(buf);
            return;
          }
        }
      };

      const onEnd = () => {
        cleanup();
        reject(new Error("Stream ended before reading enough data"));
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        stream.removeListener("readable", onReadable);
        stream.removeListener("end", onEnd);
        stream.removeListener("error", onError);
      };

      stream.on("readable", onReadable);
      stream.on("end", onEnd);
      stream.on("error", onError);

      onReadable();
    });
  }

  getDomain(): string {
    return this.domain
  }
}


function protoString(proto: ProtoType): string {
  switch (proto) {
    case ProtoType.HTTP:
      return "https://"
    case ProtoType.TCP:
      return "tcp:"
    default:
      return ""
  }
}

export function prettyPrint(level: string, ...args: string[]): void {
  for (const arg of args) {
    console.log(`wormhole [${level}] ${arg}`)
  }
}
