/**
 * Unit tests for the stream-termination fix (dsh-model-fix).
 *
 * Run against the built output: `pnpm build && pnpm test`.
 * @module dsh-model-fix/tests
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixTruncatedStream, isMissingTerminalEvent } from '../lib/fix.js'

const content = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: '你好' },
  { type: 'block-end', index: 0, block: { type: 'text', text: '你好' } },
]

const transportTruncation = {
  type: 'finish',
  reason: {
    kind: 'error',
    failure: { message: 'Stream ended without finish_reason', code: 'TRANSPORT' },
  },
}

async function collect(stream) {
  const out = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

test('isMissingTerminalEvent: recognizes the muse-spark defect finish', () => {
  assert.equal(isMissingTerminalEvent(transportTruncation), true)
  assert.equal(isMissingTerminalEvent({
    type: 'finish',
    reason: { kind: 'error', failure: { message: 'pi-ai event stream ended without done/error', code: 'STREAM_CLOSED' } },
  }), true)
})

test('isMissingTerminalEvent: rejects non-error, non-truncation, real-transport finishes', () => {
  assert.equal(isMissingTerminalEvent({ type: 'finish', reason: { kind: 'stop' } }), false)
  assert.equal(isMissingTerminalEvent({
    type: 'finish',
    reason: { kind: 'error', failure: { message: 'SocketError: other side closed', code: 'TRANSPORT' } },
  }), false)
  assert.equal(isMissingTerminalEvent({
    type: 'finish',
    reason: { kind: 'error', failure: { message: 'unauthorized', code: 'AUTH' } },
  }), false)
})

test('fixTruncatedStream: content + truncation error becomes clean stop', async () => {
  const out = await collect(fixTruncatedStream([...content, transportTruncation]))
  assert.deepEqual(out.slice(0, -1), content)
  assert.deepEqual(out.at(-1), { type: 'finish', reason: { kind: 'stop' } })
})

test('fixTruncatedStream: STREAM_CLOSED truncation after content also becomes stop', async () => {
  const out = await collect(fixTruncatedStream([...content, {
    type: 'finish',
    reason: { kind: 'error', failure: { message: 'stream ended without a terminal event', code: 'STREAM_CLOSED' } },
  }]))
  assert.deepEqual(out.at(-1), { type: 'finish', reason: { kind: 'stop' } })
})

test('fixTruncatedStream: truncation error WITHOUT content passes through', async () => {
  const out = await collect(fixTruncatedStream([transportTruncation]))
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], transportTruncation)
})

test('fixTruncatedStream: real transport failure after content passes through', async () => {
  const real = {
    type: 'finish',
    reason: { kind: 'error', failure: { message: 'SocketError: other side closed', code: 'TRANSPORT' } },
  }
  const out = await collect(fixTruncatedStream([...content, real]))
  assert.equal(out.length, content.length + 1)
  assert.deepEqual(out.at(-1), real)
})

test('fixTruncatedStream: AUTH error after content passes through', async () => {
  const auth = { type: 'finish', reason: { kind: 'error', failure: { message: '401 unauthorized', code: 'AUTH' } } }
  const out = await collect(fixTruncatedStream([...content, auth]))
  assert.deepEqual(out.at(-1), auth)
})

test('fixTruncatedStream: normal stop finish passes through untouched', async () => {
  const stop = { type: 'finish', reason: { kind: 'stop' } }
  const out = await collect(fixTruncatedStream([...content, stop]))
  assert.deepEqual(out, [...content, stop])
})

test('fixTruncatedStream: reasoning-only content counts as content', async () => {
  const reasoning = [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'think…' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think…' } },
  ]
  const out = await collect(fixTruncatedStream([...reasoning, transportTruncation]))
  assert.deepEqual(out.at(-1), { type: 'finish', reason: { kind: 'stop' } })
})

test('fixTruncatedStream: usage chunk before the finish passes through', async () => {
  const usage = { type: 'usage', usage: { inputTokens: 5, outputTokens: 3 } }
  const out = await collect(fixTruncatedStream([...content, usage, transportTruncation]))
  assert.equal(out.at(-2).type, 'usage')
  assert.deepEqual(out.at(-1), { type: 'finish', reason: { kind: 'stop' } })
})
