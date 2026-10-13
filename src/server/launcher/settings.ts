/**
 * `launcher-settings.json` — how Tandem's own Claude starts and how long it
 * runs (#2195).
 *
 * A file of its own rather than a field on the claude-code integration, for
 * three reasons. Bryan's Option C makes "run Tandem's Claude" a setting separate
 * from the connection record. `integrations.json` is `.strict()` at schema v3,
 * so a new field there means a version bump that an OLDER Tandem answers by
 * refusing the whole file — a downgrade would cost the connection, not just
 * this setting. And the wizard's whole-array `POST /api/integrations` would
 * have to carry the field or clobber it.
 *
 * **The read fails toward not starting Claude.** Only a missing file means the
 * defaults (start automatically, always running — identical to the behaviour
 * before the setting existed). Anything else that stops this module reading a
 * start mode — an antivirus lock (`EPERM`/`EBUSY` on Windows, see #2125), a
 * truncated or hand-mangled file, a FIFO, an unknown mode — reads as `on-click`.
 * Falling back to `auto` would start an agent on the user's documents against
 * an explicit Off whenever the file was briefly unreadable.
 *
 * **A newer file is read leniently and never written over.** A future version
 * may add fields; each field this build knows is kept if valid and unknown keys
 * are ignored, so a downgrade keeps the user's start mode. The write path
 * refuses (`SettingsNewerError`) rather than replacing fields it cannot see.
 *
 * Every read-modify-write goes through `withSettingsLock`, one module-level
 * queue, so the supervisor's writes (Start from off, Turn off) and the route's
 * (with no supervisor alive) can never lose each other's update.
 */

import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_LAUNCHER_SETTINGS,
  isLauncherIdleMinutes,
  isLauncherLifetime,
  isLauncherStartMode,
  type LauncherSettings,
  type LauncherSettingsPatch,
} from "../../shared/launcher/contract.js";
import { atomicWriteConfigFile } from "../integrations/storage.js";

export const LAUNCHER_SETTINGS_FILE_NAME = "launcher-settings.json";
/** The version this build writes. A file with a higher one is read-only. */
export const LAUNCHER_SETTINGS_VERSION = 1;
/** A settings file is three short fields. Anything bigger is not one, and
 * refusing it before the read keeps a planted `/dev/zero` symlink or a huge
 * file from stalling the boot plan. */
const MAX_SETTINGS_BYTES = 4096;

/** What a read produced, and from where:
 *   - `file` — parsed from disk; `newer` when a later Tandem wrote it.
 *   - `default` — no file; the shipped defaults.
 *   - `fallback` — the file exists but could not be used; start mode
 *     `on-click` (never `auto`), other fields defaulted. */
export type LauncherSettingsRead =
  | { source: "file"; settings: LauncherSettings; newer: boolean }
  | { source: "default"; settings: LauncherSettings }
  | { source: "fallback"; settings: LauncherSettings };

export class SettingsNewerError extends Error {
  constructor() {
    super("launcher-settings.json was written by a newer Tandem — not overwriting it");
    this.name = "SettingsNewerError";
  }
}

export function launcherSettingsPath(base: string): string {
  return path.join(base, LAUNCHER_SETTINGS_FILE_NAME);
}

function fallback(reason: string, err?: unknown): LauncherSettingsRead {
  console.error(
    `[Launcher] launcher-settings.json is unusable (${reason}) — Tandem's Claude will wait for Start`,
    ...(err === undefined ? [] : [err]),
  );
  return { source: "fallback", settings: { ...DEFAULT_LAUNCHER_SETTINGS, startMode: "on-click" } };
}

/** Read the settings. Never throws — see the module header for what each
 * failure reads as. */
export async function readLauncherSettings(base: string): Promise<LauncherSettingsRead> {
  const file = launcherSettingsPath(base);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { source: "default", settings: { ...DEFAULT_LAUNCHER_SETTINGS } };
    }
    return fallback("stat failed", err);
  }
  if (!stat.isFile()) return fallback("not a regular file");
  if (stat.size > MAX_SETTINGS_BYTES) return fallback("too large");
  let raw: string;
  try {
    raw = await fs.promises.readFile(file, "utf8");
  } catch (err) {
    return fallback("read failed", err);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback("not JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fallback("not an object");
  }
  const r = parsed as Record<string, unknown>;
  if (typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1) {
    return fallback("no valid version");
  }
  // The start mode is the field whose wrong default costs most, so an invalid
  // one is a fallback rather than a silently defaulted field.
  if (!isLauncherStartMode(r.startMode)) return fallback("no valid startMode");
  return {
    source: "file",
    newer: r.version > LAUNCHER_SETTINGS_VERSION,
    settings: {
      startMode: r.startMode,
      lifetime: isLauncherLifetime(r.lifetime) ? r.lifetime : DEFAULT_LAUNCHER_SETTINGS.lifetime,
      idleMinutes: isLauncherIdleMinutes(r.idleMinutes)
        ? r.idleMinutes
        : DEFAULT_LAUNCHER_SETTINGS.idleMinutes,
    },
  };
}

async function writeLauncherSettings(base: string, settings: LauncherSettings): Promise<void> {
  await atomicWriteConfigFile(
    launcherSettingsPath(base),
    `${JSON.stringify({ version: LAUNCHER_SETTINGS_VERSION, ...settings }, null, 2)}\n`,
  );
}

let settingsQueue: Promise<void> = Promise.resolve();

/** Serialize a settings read-modify-write against every other one in this
 * process. */
function withSettingsLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = settingsQueue.then(fn, fn);
  settingsQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Merge `patch` into the stored settings and write the result. Returns the
 * settings as stored. Throws `SettingsNewerError` for a file from a newer
 * Tandem, and whatever the write throws.
 *
 * A fallback read is merged too: the user is setting a value now, and what they
 * set must win over a file we could not read. The fields they did not touch get
 * the fallback's values — `on-click` for an unreadable start mode, which is the
 * value Tandem was already behaving by.
 */
export function updateLauncherSettings(
  base: string,
  patch: LauncherSettingsPatch,
): Promise<LauncherSettings> {
  return withSettingsLock(async () => {
    const current = await readLauncherSettings(base);
    if (current.source === "file" && current.newer) throw new SettingsNewerError();
    const next: LauncherSettings = { ...current.settings, ...patch };
    await writeLauncherSettings(base, next);
    return next;
  });
}
