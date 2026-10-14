/**
 * The wizard's saved-setup merge (#2198): pre-fill from `integrations.json`,
 * and save back without losing what the wizard does not own.
 *
 * Before this, `begin()` read only the detected installs and `save()` POSTed a
 * file built from the picked cards alone — a whole-file replace. Every Apply
 * therefore dropped `workingDirectory` (the cwd Tandem's Claude spawns in),
 * `tokenSecretRef` (orphaning its keychain secret), `nodeBinary`, every
 * `other-mcp` or not-detected-right-now record and `defaultIntegrationId`, and
 * preselected targets the user never chose. Harmless while the wizard opened
 * only for people with nothing saved; the v1.0 walkthrough sends everyone
 * through it.
 *
 * The rules, all pure so they are tested without a component:
 *   - A detected install MATCHES a saved record of its kind by `configPath`
 *     (separator- and case-folded — Windows casing, older record forms), or,
 *     when there is exactly one record and one install of that kind, by kind
 *     alone (Apply itself collapses per kind).
 *   - A matched card is built FROM the record: its id, ref, cwd and the rest
 *     ride along, so nothing is minted fresh for it.
 *   - Saving rebuilds the file in its ORIGINAL order from the fresh record
 *     (re-read at save time, so a cwd change made meanwhile survives), with
 *     only the wizard-owned fields — the config path, a newly entered token,
 *     the apply intent — taken from the card. The launcher takes the first
 *     launchable claude-code record, so order is behaviour.
 *   - A record the user did not pick is kept unchanged; one they explicitly
 *     unchecked this session is kept as `apply: "skip"` (the schema's
 *     configured-but-disabled, which the launcher honours). New picks append.
 */

import type {
  ExistingMcpInstall,
  IntegrationConfig,
  IntegrationsFile,
} from "../../shared/integrations/contract.js";
import { INTEGRATIONS_SCHEMA_VERSION } from "../../shared/integrations/contract.js";

/** The wizard card — re-declared here so this module needs no Svelte. */
export interface MergePicked {
  id: string;
  config: IntegrationConfig;
  /** Built from a saved record (its id is the record's). */
  fromRecord?: true;
}

/** Same rule as the hook's `tandemEntryValidationFailed`, kept beside its use. */
function validationFailed(install: ExistingMcpInstall): boolean {
  return install.tandemValidation !== undefined && install.tandemValidation.status !== "valid";
}

/** A Tandem entry on disk that the wizard would leave in place. */
export function hasValidTandemEntry(install: ExistingMcpInstall): boolean {
  return install.tandemEntry !== undefined && !validationFailed(install);
}

export function normalizeConfigPath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function recordConfigPath(record: IntegrationConfig): string | undefined {
  return "configPath" in record && typeof record.configPath === "string"
    ? record.configPath
    : undefined;
}

/** The saved record a detected install stands for, if any. */
export function matchRecord(
  install: ExistingMcpInstall,
  records: readonly IntegrationConfig[],
  installs: readonly ExistingMcpInstall[],
): IntegrationConfig | undefined {
  const kind = install.target.kind;
  const sameKind = records.filter((r) => r.kind === kind);
  const key = normalizeConfigPath(install.target.configPath);
  const exact = sameKind.find((r) => {
    const p = recordConfigPath(r);
    return p !== undefined && normalizeConfigPath(p) === key;
  });
  if (exact) return exact;
  const installsOfKind = installs.filter((i) => i.target.kind === kind);
  return sameKind.length === 1 && installsOfKind.length === 1 ? sameKind[0] : undefined;
}

/** A card built from a saved record: everything rides along except the
 * apply intent, which `buildSaveFile` decides. */
export function recordToConfig(
  install: ExistingMcpInstall,
  record: IntegrationConfig,
): IntegrationConfig {
  const { apply: _apply, ...rest } = record;
  return "configPath" in rest
    ? ({ ...rest, configPath: install.target.configPath } as IntegrationConfig)
    : (rest as IntegrationConfig);
}

/**
 * Whether the wizard preselects only what is already set up. True as soon as
 * anything is: a saved claude record or a valid entry on disk. Only a user with
 * neither gets today's "preselect everything connectable".
 */
export function preselectsSelectively(
  installs: readonly ExistingMcpInstall[],
  records: readonly IntegrationConfig[],
): boolean {
  return records.some((r) => r.kind !== "other-mcp") || installs.some(hasValidTandemEntry);
}

/** Whether a selectable install starts checked. A saved record decides for
 * itself (`skip` is the user's own "disabled"); otherwise a valid entry on
 * disk does. */
export function preselects(
  install: ExistingMcpInstall,
  record: IntegrationConfig | undefined,
  selective: boolean,
): boolean {
  if (!selective) return true;
  return record ? record.apply !== "skip" : hasValidTandemEntry(install);
}

function applyIntentFor(
  config: IntegrationConfig,
  existing: readonly ExistingMcpInstall[],
): IntegrationConfig["apply"] {
  // `other-mcp` is constrained to apply: "skip" by the schema.
  if (config.kind === "other-mcp") return "skip";
  // A hand-edited entry on disk that failed validation is left alone: apply
  // would replace it with the canonical shape and erase the customisation.
  const p = recordConfigPath(config);
  const matched =
    p === undefined
      ? undefined
      : existing.find((e) => normalizeConfigPath(e.target.configPath) === normalizeConfigPath(p));
  return matched !== undefined && validationFailed(matched) ? "skip" : "create";
}

export interface BuildSaveInput {
  /** The record as re-read at save time. */
  saved: IntegrationsFile;
  picked: readonly MergePicked[];
  existing: readonly ExistingMcpInstall[];
  /** Saved records the user unchecked this session. */
  deselected: ReadonlySet<string>;
  /** Each saved record's `tokenSecretRef` when the wizard opened, by id — the
   * baseline a newly entered token is told apart from. */
  originalRefs: ReadonlyMap<string, string | undefined>;
}

export interface BuildSaveOutput {
  file: IntegrationsFile;
  /** The ids to APPLY: the picked cards only, never a kept record. */
  applyIds: string[];
  /** Saved refs a newly entered token replaced: delete them once the new
   * file is persisted, and never before. */
  superseded: string[];
}

export function buildSaveFile(input: BuildSaveInput): BuildSaveOutput {
  const { saved, picked, existing, deselected, originalRefs } = input;
  const pickedById = new Map(picked.map((p) => [p.id, p]));
  const superseded: string[] = [];
  const integrations = saved.integrations.map((record): IntegrationConfig => {
    const card = pickedById.get(record.id);
    if (card) {
      pickedById.delete(record.id);
      const original = originalRefs.get(record.id);
      const newRef = card.config.tokenSecretRef;
      const replaced = newRef !== undefined && newRef !== original;
      if (replaced && original !== undefined) superseded.push(original);
      const cardPath = recordConfigPath(card.config);
      const merged = {
        ...record,
        ...("configPath" in record && cardPath !== undefined ? { configPath: cardPath } : {}),
        ...(replaced ? { tokenSecretRef: newRef } : {}),
      } as IntegrationConfig;
      return { ...merged, apply: applyIntentFor(merged, existing) } as IntegrationConfig;
    }
    if (deselected.has(record.id) && record.kind !== "other-mcp") {
      return { ...record, apply: "skip" } as IntegrationConfig;
    }
    return record;
  });
  for (const card of pickedById.values()) {
    integrations.push({
      ...card.config,
      apply: applyIntentFor(card.config, existing),
    } as IntegrationConfig);
  }
  const keepsDefault =
    saved.defaultIntegrationId !== undefined &&
    integrations.some((i) => i.id === saved.defaultIntegrationId);
  return {
    file: {
      schemaVersion: INTEGRATIONS_SCHEMA_VERSION,
      integrations,
      ...(keepsDefault ? { defaultIntegrationId: saved.defaultIntegrationId } : {}),
    },
    applyIds: picked.map((p) => p.id),
    superseded,
  };
}
