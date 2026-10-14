// @vitest-environment happy-dom

/**
 * The wizard's offer to install Claude Code for a Claude Desktop setup (#2199).
 * Opt-in, never pre-selected: it shows only beside a detected Claude Desktop
 * with no Claude Code anywhere, its Install is a secondary button, and the card
 * that a successful install brings is ticked because the click was the opt-in
 * (Bryan, 2026-10-14). Mounted with the two stateful hooks stubbed, like
 * `integration-wizard-install.test.ts`.
 */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ClaudeCliPresence,
  ExistingMcpInstall,
} from "../../src/shared/integrations/contract.js";

const cliStub: {
  presence: ClaudeCliPresence | null;
  bareNameLaunchable: boolean | null;
  loading: boolean;
  error: string | null;
  installing: boolean;
  installError: string | null;
  install: ReturnType<typeof vi.fn<() => Promise<ClaudeCliPresence | null>>>;
  refetch: ReturnType<typeof vi.fn<() => Promise<void>>>;
} = {
  presence: null,
  bareNameLaunchable: null,
  loading: false,
  error: null,
  installing: false,
  installError: null,
  install: vi.fn(async () => null),
  refetch: vi.fn(async () => {}),
};

vi.mock(import("../../src/client/hooks/useClaudeCliStatus.svelte"), () => ({
  createClaudeCliStatus: () => cliStub,
}));

const desktopInstall = {
  target: {
    kind: "claude-desktop",
    label: "Claude Desktop",
    configPath: "/home/u/claude_desktop_config.json",
  },
  status: "ok",
} as ExistingMcpInstall;
const codeInstall = {
  target: { kind: "claude-code", label: "Claude Code", configPath: "/home/u/.claude.json" },
  status: "missing",
} as ExistingMcpInstall;

const existing: ExistingMcpInstall[] = [];
const refreshDetected = vi.fn(
  async (_opts?: { pickNewOfKind?: string }): Promise<ExistingMcpInstall[]> => [],
);

vi.mock(import("../../src/client/hooks/useIntegrationWizard.svelte"), async (importOriginal) => ({
  ...(await importOriginal()),
  createIntegrationWizard: () => ({
    step: "connect" as const,
    detecting: false,
    get existing() {
      return existing;
    },
    picked: [],
    applyResults: [],
    tandemClaude: null,
    errorMessage: null,
    channelRegistered: null,
    keychainUnavailable: false,
    begin: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    reset: vi.fn(),
    setPicked: vi.fn(),
    submitSecret: vi.fn(async () => {}),
    cleanupUnsavedSecrets: vi.fn(async () => {}),
    hasSetupToKeep: false,
    keepError: null,
    keepSetup: vi.fn(async () => true),
    pickedForInstall: vi.fn(() => null),
    refreshDetected,
  }),
}));

vi.mock(import("../../src/client/hooks/useCoworkStatus.svelte"), () => ({
  createCoworkStatus: () => ({
    status: null,
    loading: false,
    error: null,
    refetch: vi.fn(async () => true),
  }),
}));

import IntegrationWizardModal from "../../src/client/components/IntegrationWizardModal.svelte";

function q(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function mount(props: Record<string, unknown> = {}) {
  return render(IntegrationWizardModal, { props: { open: true, onClose: vi.fn(), ...props } });
}

describe("IntegrationWizardModal — the Claude Code offer for a Claude Desktop setup (#2199)", () => {
  beforeEach(() => {
    existing.length = 0;
    existing.push(desktopInstall);
    cliStub.presence = "NOT_INSTALLED";
    cliStub.installing = false;
    cliStub.installError = null;
    cliStub.install = vi.fn(async () => "INSTALLED_NOT_ON_PATH" as const);
    cliStub.refetch = vi.fn(async () => {});
    refreshDetected.mockReset();
    refreshDetected.mockImplementation(async () => {
      existing.push(codeInstall);
      return [codeInstall];
    });
  });
  afterEach(() => cleanup());

  it("shows for Desktop with no Claude Code, as a SECONDARY action", async () => {
    const { container } = mount();
    await tick();
    expect(q(container, "integration-wizard-claude-code-offer")).not.toBeNull();
    const install = q(container, "integration-wizard-claude-code-offer-install");
    expect(install?.className).toContain("iw-btn-secondary");
    // Honest about Desktop, and no pricing claim.
    const text = q(container, "integration-wizard-claude-code-offer")?.textContent ?? "";
    expect(text).toContain("Claude Desktop answers only when you ask it");
    expect(text).not.toMatch(/free/i);
  });

  it.each([
    ["Claude Code is already installed", () => (cliStub.presence = "INSTALLED_ON_PATH")],
    ["the CLI probe has not answered", () => (cliStub.presence = null)],
    ["a Claude Code card is already there", () => existing.push(codeInstall)],
    ["there is no Claude Desktop", () => (existing.length = 0)],
  ])("hidden when %s", async (_l, arrange) => {
    arrange();
    const { container } = mount();
    await tick();
    expect(q(container, "integration-wizard-claude-code-offer")).toBeNull();
  });

  it("Install installs, then re-reads WITHOUT starting over and ticks the new Claude Code card", async () => {
    const { container } = mount();
    await tick();
    await fireEvent.click(
      q(container, "integration-wizard-claude-code-offer-install") as HTMLElement,
    );
    await waitFor(() =>
      expect(q(container, "integration-wizard-claude-code-offer-installed")).not.toBeNull(),
    );
    expect(cliStub.install).toHaveBeenCalledTimes(1);
    expect(refreshDetected).toHaveBeenCalledWith({ pickNewOfKind: "claude-code" });
    // Focus lands on the note, not on <body> inside the focus trap.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        q(container, "integration-wizard-claude-code-offer-installed"),
      ),
    );
  });

  it("a failed install shows its error and leaves the offer in place", async () => {
    cliStub.install = vi.fn(async () => {
      cliStub.installError = "Install failed (exit 1).";
      return null;
    });
    const { container } = mount();
    await tick();
    await fireEvent.click(
      q(container, "integration-wizard-claude-code-offer-install") as HTMLElement,
    );
    await tick();
    expect(refreshDetected).not.toHaveBeenCalled();
    expect(q(container, "integration-wizard-claude-code-offer-install")).not.toBeNull();
  });

  it("installed but no card yet: Check again re-reads, keeping the user's picks", async () => {
    refreshDetected.mockImplementationOnce(async () => []);
    const { container } = mount();
    await tick();
    await fireEvent.click(
      q(container, "integration-wizard-claude-code-offer-install") as HTMLElement,
    );
    const recheck = await waitFor(() => {
      const el = q(container, "integration-wizard-claude-code-offer-recheck");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await fireEvent.click(recheck);
    await waitFor(() =>
      expect(q(container, "integration-wizard-claude-code-offer-installed")).not.toBeNull(),
    );
    expect(cliStub.refetch).toHaveBeenCalled();
    expect(refreshDetected).toHaveBeenCalledTimes(2);
  });

  it("opened from the chat panel's offer, it focuses the Install button", async () => {
    const { container } = mount({ focusClaudeCodeOffer: true });
    await tick();
    await tick();
    expect(document.activeElement).toBe(
      q(container, "integration-wizard-claude-code-offer-install"),
    );
  });
});
