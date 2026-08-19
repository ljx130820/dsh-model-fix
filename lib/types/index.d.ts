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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "model-fix";
export declare const inject: string[];
/** Plugin configuration. */
export interface Config {
    /** Regex tested against the model id; defaults to the muse-spark models. */
    modelPattern: string;
    /**
     * Provider allowlist (route keys, e.g. `opencode-go3`). Empty means every
     * provider the pattern matches.
     */
    providers: string[];
}
export declare const Config: z<Schemastery.ObjectS<{
    modelPattern: z<string, string>;
    providers: z<string[], string[]>;
}>, Schemastery.ObjectT<{
    modelPattern: z<string, string>;
    providers: z<string[], string[]>;
}>>;
/**
 * Fix truncated-stream finishes for matching model requests.
 * @param ctx - plugin context; provides the typed `llm/stream` waterfall.
 * @param config - resolved plugin configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
