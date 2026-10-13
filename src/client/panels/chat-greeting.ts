import type { AiRemedy } from "../hooks/useAiReadiness.svelte";

/**
 * The chat panel's note when Tandem's Claude was asked for its one-time hello
 * and nothing arrived (#2197; Bryan: "Claude didn't respond — here's how to fix
 * it"). Whether it shows is the server's call (`LauncherStatus.greetingLate`),
 * never the chat map's, so clearing the chat cannot make it appear.
 *
 * The action: `relaunch` while Tandem's Claude is still running — restarting it
 * after the fix is what retries the hello, because the marker stays owed until
 * one arrives — otherwise the stopped launcher's own remedy (sign-in first, for
 * the usual cause).
 */
export type GreetingAction = AiRemedy | "relaunch";

export const GREETING_LATE_TEXT =
  "Tandem's Claude hasn't said hello. It may not be signed in to Claude Code, or not allowed to use Tandem's tools — see “Tandem's Claude didn't say hello” in the troubleshooting guide.";

export const GREETING_RELAUNCH = {
  label: "Restart Tandem's Claude",
  title: "Restart Tandem's Claude, after signing in or allowing its tools, to try the hello again.",
  ariaLabel: "Restart Tandem's Claude.",
} as const;
