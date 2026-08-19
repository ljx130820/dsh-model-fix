/**
 * Stream-termination fix for models whose provider never emits a terminal
 * event.
 *
 * The opencode aggregator's `muse-spark-1.2` implementation streams content
 * chunks but neither sends a chunk carrying `finish_reason` nor a `[DONE]`
 * marker; the wire simply closes. pi-ai's openai-completions provider turns
 * that into an `error` event ("Stream ended without finish_reason"), which
 * llm-pi-ai maps to a TRANSPORT finish — so every turn produced content and
 * then failed, and the agent-level retry policy (TRANSPORT is in the default
 * retryable set) re-ran the whole step up to `maxRetries` times.
 *
 * This module converts exactly that failure into a clean `stop` finish, but
 * only when the stream already delivered content. A genuine mid-stream
 * network drop is also classified TRANSPORT, so the fix additionally requires
 * the failure message to name a missing terminal event; real transport
 * failures keep failing as before.
 *
 * @module dsh-model-fix/fix
 */
/** Failure codes a missing-terminal-event defect surfaces as. */
const TRUNCATION_CODES = new Set(['TRANSPORT', 'STREAM_CLOSED']);
/**
 * Message patterns the failing providers share: the wire ended before a
 * terminal event arrived. Matched deliberately narrowly so a genuine network
 * drop (also TRANSPORT) is never mistaken for this defect.
 */
const TRUNCATION_MESSAGE = /stream ended (?:before|without)|without finish_reason/i;
/** Content-bearing chunk types; presence of any of them means the turn produced output. */
const CONTENT_CHUNK_TYPES = new Set(['text-delta', 'reasoning-delta', 'tool-call-delta']);
/**
 * True when a finish chunk is the missing-terminal-event defect: an error
 * finish with a truncation code whose message names the absent terminal
 * event.
 * @param chunk - one stream chunk.
 * @returns whether the chunk is the target defect's terminal failure.
 */
export function isMissingTerminalEvent(chunk) {
    if (chunk.type !== 'finish' || chunk.reason.kind !== 'error')
        return false;
    const { code, message } = chunk.reason.failure;
    return TRUNCATION_CODES.has(code) && TRUNCATION_MESSAGE.test(message);
}
/**
 * Wrap a model stream so the missing-terminal-event defect becomes a clean
 * stop. Chunks pass through unchanged until the stream either ends normally
 * or ends with the defect; in the defect case a stop finish is emitted
 * instead of the error. Streams that produced no content keep their error —
 * an empty turn is a real failure, not a truncation artifact.
 * @param upstream - the adapter chunk stream (from the `llm/stream` next()).
 * @returns the corrected chunk stream.
 */
export async function* fixTruncatedStream(upstream) {
    let sawContent = false;
    for await (const chunk of upstream) {
        if (CONTENT_CHUNK_TYPES.has(chunk.type)) {
            sawContent = true;
        }
        if (isMissingTerminalEvent(chunk) && sawContent) {
            yield { type: 'finish', reason: { kind: 'stop' } };
            return;
        }
        yield chunk;
    }
}
