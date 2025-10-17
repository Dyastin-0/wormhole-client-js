import { test, describe } from 'node:test';
import assert from 'node:assert';
import { deserializeHeader, deserializeMetrics, deserializeRequest, deserializeResponse, FLAG_METRICS, Header, MessageType, Metrics, ProtoType, Request, Response, serializeHeader, serializeMetrics, serializeRequest, serializeResponse, StatusCode, } from './proto.js';

describe("Header", () => {
  test("SerializeDeserialize", () => {
    const header = new Header(MessageType.Ack, BigInt(420))
    const buf = serializeHeader(header)
    const newHeader = deserializeHeader(buf)
    assert.deepEqual(header, newHeader, "header not match")
  })
})

describe("HeaderFlags", () => {
  test("SetCheckClearFlag", () => {
    const header = new Header(MessageType.Ack, BigInt(0))
    header.setFlag(FLAG_METRICS)
    assert.equal(header.hasFlag(FLAG_METRICS), true, "missing flag")
    header.clearFlag(FLAG_METRICS)
    assert.equal(header.hasFlag(FLAG_METRICS), false, "flag found")
  })
})

describe("Request", () => {
  test("SerializeDeserialize", () => {
    const req = new Request(ProtoType.TCP, "hello")
    const buf = serializeRequest(req)
    const newReq = deserializeRequest(buf)
    assert.deepEqual(req, newReq, "request not match")
  })
})

describe("Response", () => {
  test("SerializeDeserialize", () => {
    const res = new Response(StatusCode.OK, BigInt(60000), "test.com")
    const buf = serializeResponse(res)
    const newRes = deserializeResponse(buf)
    assert.deepEqual(res, newRes, "reponse not match")
  })
})

describe("Metrics", () => {
  test("SerializeDeserialize", () => {
    const metrics = new Metrics(BigInt(420), BigInt(69), BigInt(20000), BigInt(111), 222)
    const buf = serializeMetrics(metrics)
    const newMetrics = deserializeMetrics(buf)
    assert.deepEqual(metrics, newMetrics, "metrics not match")
  })
})
