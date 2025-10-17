export const VERSION = 0x10
export const version = "1.0"
export const MAX_PAYLOAD_SIZE = 1024 * 1024
export const MAX_STRING_LENGTH = 4096
export const HEADER_SIZE = 12
export const REQUEST_SIZE = 5
export const RESPONSE_SIZE = 13
export const METRICS_SIZE = 36

export const MessageType = {
  Request: 0x01,
  Response: 0x02,
  Access: 0x03,
  Ack: 0x04,
  Metrics: 0x05,
  End: 0x06,
  Error: 0xff,
} as const

export type MessageType = typeof MessageType[keyof typeof MessageType]

export const FLAG_METRICS = 0x01

export const ProtoType = {
  HTTP: 0x01,
  TCP: 0x02,
} as const

export type ProtoType = typeof ProtoType[keyof typeof ProtoType]

export const StatusCode = {
  OK: 0x01,
  NameTaken: 0x03,
  UnsupportedProto: 0x04,
} as const

export type StatusCode = typeof StatusCode[keyof typeof StatusCode]

export class Header {
  version: number = VERSION
  type: MessageType
  flags: number = 0
  length: bigint = 0n
  reserved: number = 0

  constructor(type: MessageType, length: bigint) {
    this.type = type
    this.length = length
  }

  hasFlag(flag: number): boolean {
    return (this.flags & flag) !== 0
  }

  setFlag(flag: number) {
    this.flags |= flag
  }

  clearFlag(flag: number) {
    this.flags = this.flags & ~flag
  }
}

export class Request {
  proto: ProtoType
  nameLength: number
  name: string

  constructor(proto: ProtoType, name: string) {
    this.proto = proto
    this.nameLength = Buffer.byteLength(name, "utf8")
    this.name = name
  }
}

export class Response {
  status: StatusCode
  ttlHours: bigint
  domainLength: number
  domain: string

  constructor(status: StatusCode, ttlHours: bigint, domain: string) {
    this.status = status
    this.ttlHours = ttlHours
    this.domainLength = Buffer.byteLength(domain, "utf8")
    this.domain = domain
  }
}

export class Metrics {
  ingress: bigint
  egress: bigint
  uptime: bigint
  connectionCount: bigint
  activeConnections: number

  constructor(
    ingress: bigint,
    egress: bigint,
    uptime: bigint,
    connectionCount: bigint,
    activeConnections: number
  ) {
    this.ingress = ingress
    this.egress = egress
    this.uptime = uptime
    this.connectionCount = connectionCount
    this.activeConnections = activeConnections
  }
}

export function serializeHeader(header: Header): Buffer {
  validateHeader(header)

  const buf = Buffer.alloc(HEADER_SIZE)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  view.setUint8(0, header.version)
  view.setUint8(1, header.type)
  view.setUint8(2, header.flags)
  view.setBigUint64(3, header.length, false)
  view.setUint8(11, header.reserved)

  return buf
}

export function deserializeHeader(buf: Buffer): Header {
  if (buf.length < HEADER_SIZE) {
    throw new Error("invalid header size")
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.length)
  const header = new Header(
    view.getUint8(1) as MessageType,
    view.getBigUint64(3, false)
  )
  header.version = view.getUint8(0)
  header.flags = view.getUint8(2)
  header.reserved = view.getUint8(11)

  validateHeader(header)

  return header
}

export function serializeRequest(req: Request): Buffer {
  validateRequest(req)

  const nameBytes = Buffer.from(req.name, "utf8")
  const buf = Buffer.alloc(REQUEST_SIZE + nameBytes.length)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  view.setUint8(0, req.proto)
  view.setUint32(1, req.nameLength, false)
  nameBytes.copy(buf, REQUEST_SIZE)

  return buf
}

export function deserializeRequest(buf: Buffer): Request {
  if (buf.length < REQUEST_SIZE) {
    throw new Error("invalid request size")
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.length)
  const proto = view.getUint8(0) as ProtoType
  const nameLength = view.getUint32(1, false)

  const expectedSize = REQUEST_SIZE + nameLength
  if (buf.length < expectedSize) {
    throw new Error("insufficient data")
  }

  const nameBytes = buf.subarray(REQUEST_SIZE, REQUEST_SIZE + nameLength)
  const name = nameBytes.toString("utf8")

  const req = new Request(proto, name)
  validateRequest(req)

  return req
}

export function serializeResponse(resp: Response): Buffer {
  validateResponse(resp)

  const domainBytes = Buffer.from(resp.domain, "utf8")
  const buf = Buffer.alloc(RESPONSE_SIZE + domainBytes.length)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  view.setUint8(0, resp.status)
  view.setBigUint64(1, resp.ttlHours, false)
  view.setUint32(9, resp.domainLength, false)
  domainBytes.copy(buf, RESPONSE_SIZE)

  return buf
}

export function deserializeResponse(buf: Buffer): Response {
  if (buf.length < RESPONSE_SIZE) {
    throw new Error("invalid response size")
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.length)
  const status = view.getUint8(0) as StatusCode
  const ttlHours = view.getBigUint64(1, false)
  const domainLength = view.getUint32(9, false)

  const expectedSize = RESPONSE_SIZE + domainLength
  if (buf.length < expectedSize) {
    throw new Error("insufficient data")
  }

  const domainBytes = buf.subarray(RESPONSE_SIZE, RESPONSE_SIZE + domainLength)
  const domain = domainBytes.toString("utf8")

  const resp = new Response(status, ttlHours, domain)
  validateResponse(resp)

  return resp
}

export function serializeMetrics(metrics: Metrics): Buffer {
  const buf = Buffer.alloc(METRICS_SIZE)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  view.setBigUint64(0, metrics.ingress, false)
  view.setBigUint64(8, metrics.egress, false)
  view.setBigUint64(16, metrics.uptime, false)
  view.setBigUint64(24, metrics.connectionCount, false)
  view.setUint32(32, metrics.activeConnections, false)

  return buf
}

export function deserializeMetrics(buf: Buffer): Metrics {
  if (buf.length < METRICS_SIZE) {
    throw new Error("invalid metrics size")
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.length)

  return new Metrics(
    view.getBigUint64(0, false),
    view.getBigUint64(8, false),
    view.getBigUint64(16, false),
    view.getBigUint64(24, false),
    view.getUint32(32, false)
  )
}

export function calculateTunnelRequestSize(req: Request): number {
  return HEADER_SIZE + REQUEST_SIZE + Buffer.byteLength(req.name, "utf8")
}

export function calculateTunnelResponseSize(resp: Response): number {
  return HEADER_SIZE + RESPONSE_SIZE + Buffer.byteLength(resp.domain, "utf8")
}

function validateHeader(header: Header) {
  if (header.version !== VERSION) {
    throw new Error("invalid version")
  }

  if (header.length > BigInt(MAX_PAYLOAD_SIZE)) {
    throw new Error("payload too large")
  }


  if (header.reserved !== 0) {
    throw new Error("reserved field must be zero")
  }
}

function validateRequest(req: Request) {
  if (req.proto !== ProtoType.HTTP && req.proto !== ProtoType.TCP) {
    throw new Error("invalid protocol")
  }

  if (req.name.length === 0 || req.nameLength === 0) {
    throw new Error("string field cannot be empty")
  }

  const actualLength = Buffer.byteLength(req.name, "utf8")
  if (req.nameLength !== actualLength) {
    throw new Error("invalid length field")
  }

  if (req.nameLength > MAX_STRING_LENGTH) {
    throw new Error("string exceeds maximum length")
  }
}

function validateResponse(resp: Response) {
  if (
    resp.status !== StatusCode.OK &&
    resp.status !== StatusCode.NameTaken &&
    resp.status !== StatusCode.UnsupportedProto
  ) {
    throw new Error("invalid status code")
  }

  if (resp.status === StatusCode.OK) {
    if (resp.domain.length === 0 || resp.domainLength === 0) {
      throw new Error("string field cannot be empty")
    }

    const actualLength = Buffer.byteLength(resp.domain, "utf8")
    if (resp.domainLength !== actualLength) {
      throw new Error("invalid length field")
    }

    if (resp.domainLength > MAX_STRING_LENGTH) {
      throw new Error("string exceeds maximum length")
    }
  }
}
