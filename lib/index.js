/**
 * dsh-model-fix — 模型流式缺陷修复。
 *
 * A host-plane plugin that hooks the `llm/stream` waterfall and converts the
 * missing-terminal-event defect (opencode aggregator's `muse-spark-1.2`
 * streams content but never sends `finish_reason` / `[DONE]`, so pi-ai ends
 * every turn with "Stream ended without finish_reason" → TRANSPORT) into a
 * clean `stop` finish — but only for matching models, and only when content
 * was actually delivered. Real transport failures still fail as before.
 *
 * Installation (bundle): `dsh plugin --profile <name> add dsh-model-fix`
 * (or a local path). The bundle patch mounts this plugin row into the host
 * composition; no realm, no client half.
 *
 * @module dsh-model-fix
 */
import z from '@deepseek-ai/schemastery';
import { fixTruncatedStream } from "./fix.js";
export const name = 'model-fix';
export const inject = ['llm'];
export const Config = z.object({
    modelPattern: z.string().default('^muse-spark'),
    providers: z.array(z.string()).default([]),
});
/**
 * Fix truncated-stream finishes for matching model requests.
 * @param ctx - plugin context; provides the typed `llm/stream` waterfall.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx, config) {
    // Compile eagerly so a bad pattern fails at load, not on the first request.
    const modelPattern = new RegExp(config.modelPattern);
    const providers = new Set(config.providers);
    ctx.on('llm/stream', (options, next) => {
        if (providers.size > 0 && !providers.has(options.provider))
            return next();
        if (!modelPattern.test(options.model))
            return next();
        return fixTruncatedStream(next());
    });
}
