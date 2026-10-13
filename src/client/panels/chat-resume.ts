import type { LauncherStandby } from "../../shared/launcher/contract";
import type { AiChip } from "../hooks/useAiReadiness.svelte";

/**
 * The chat panel's "Claude is resuming…" row (#2196): what happened to a chat
 * message the user sent while Tandem's Claude was stopped by choice.
 *
 * The server starts Claude for such a message on its own (the supervisor's
 * standby watch); this only reports it. A request is recorded at send time and
 * ONLY when the server said a message would start Claude
 * (`launcherStartsOnMessage`), so the row never promises an answer nothing is
 * coming to give — with another AI attached, or the licence refusing, there is
 * no request and no row.
 *
 * Once Claude is running the row steps aside for the pickup row, which reads
 * the chat map and knows whether the message was read.
 */
export type ChatResume =
  | { kind: "resuming"; verb: "resuming" | "starting" }
  | { kind: "failed"; remedy: Exclude<AiChip, null> };

export interface ChatResumeRequest {
  at: number;
  /** The standby at send time: an idle-stopped Claude is "resuming", one that
   * was off or never started this session is "starting". */
  from: LauncherStandby;
}

/** How long a start may take to show up in the launcher status before the row
 * stops promising. The status poll is 8 s and the post-send re-reads land well
 * inside this, so a start that has not begun by then is not coming. */
export const RESUME_GRACE_MS = 20_000;

export interface ChatResumeInput {
  running: boolean;
  /** A start or restart is under way (`launcherRestarting`). */
  restarting: boolean;
  /** Still in standby with nothing under way. */
  standby: LauncherStandby | null;
  /** `launcherRemedy`. */
  remedy: Exclude<AiChip, null> | null;
  now: number;
}

export function chatResume(
  request: ChatResumeRequest | null,
  input: ChatResumeInput,
): ChatResume | null {
  if (request === null || input.running) return null;
  const verb = request.from === "idle" ? "resuming" : "starting";
  if (input.restarting) return { kind: "resuming", verb };
  // Still in standby: the server has not begun yet. Inside the grace that is
  // the normal gap between the send and the next status read.
  if (input.standby !== null) {
    return input.now - request.at < RESUME_GRACE_MS
      ? { kind: "resuming", verb }
      : { kind: "failed", remedy: "start" };
  }
  // Not running, not starting, not in standby: the start ended in a failure
  // the launcher reports (`lastError`, not-configured) — or the status is
  // unknown for now, which earns the grace and then silence, never a claim.
  if (input.remedy !== null) return { kind: "failed", remedy: input.remedy };
  return input.now - request.at < RESUME_GRACE_MS ? { kind: "resuming", verb } : null;
}

const RESUMING_TEXT = {
  resuming: "Claude is resuming… it will answer when it's back.",
  starting: "Starting Tandem's Claude… it will answer when it's ready.",
} as const;

export const RESUME_FAILED_TEXT =
  "Tandem's Claude couldn't start, so your message hasn't been answered yet.";

/** The row's line; the visible row and the announcement both read it. */
export function chatResumeLabel(resume: ChatResume): string {
  return resume.kind === "failed" ? RESUME_FAILED_TEXT : RESUMING_TEXT[resume.verb];
}
