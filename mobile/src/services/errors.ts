/**
 * Errors the UI can translate. The services keep throwing a Spanish `message` (logs and
 * old string checks rely on it); `key` and `vars` are what gets shown. Pure module.
 */
import type { MessageKey } from "../lib/i18n";

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export class LocalizedError extends Error {
  constructor(
    readonly key: MessageKey,
    message: string,
    readonly vars: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = "LocalizedError";
  }
}

/** Sentence to show for any thrown value: the translated one when the error carries a key. */
export function errorText(err: unknown, t: Translate): string {
  if (err instanceof Error && "key" in err && typeof err.key === "string") {
    const vars = "vars" in err && err.vars && typeof err.vars === "object" ? (err.vars as Record<string, string | number>) : undefined;
    return t(err.key as MessageKey, vars);
  }
  return err instanceof Error ? err.message : String(err);
}
