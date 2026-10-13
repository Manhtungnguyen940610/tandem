// @vitest-environment happy-dom

import { cleanup, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { AI_CTA } from "../../src/client/hooks/useAiReadiness.svelte";
import ChatPanel from "../../src/client/panels/ChatPanel.svelte";
import type { ChatResume } from "../../src/client/panels/chat-resume";
import type { ChatMessage } from "../../src/shared/types";

function renderChat(messages: ChatMessage[]) {
  return render(ChatPanel, {
    props: {
      messages,
      editor: null,
      activeDocId: null,
      openDocs: [],
      capturedAnchor: null,
      onCapturedAnchorChange: () => {},
      onSend: () => true,
      onClear: async () => {},
      onExport: async () => {},
      onInsert: () => false,
      tandemClaudeControl: null,
      onStartClaude: () => {},
      onTurnOffClaude: () => {},
      tandemClaudeResume: null,
      onResumeRemedy: () => {},
    },
  });
}

function claudeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    author: "claude",
    text: "hello",
    timestamp: 1,
    ...overrides,
  } as ChatMessage;
}

function authorStyle(container: HTMLElement, id: string): string {
  return container.querySelector(`[data-testid='chat-author-${id}']`)?.getAttribute("style") ?? "";
}

function bubble(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`[data-testid='chat-author-${id}']`)?.parentElement
    ?.parentElement as HTMLElement;
}

describe("ChatPanel per-agent author color (#1123 M4)", () => {
  it("a claude message WITH agentIdentity colors the author with the per-agent token", () => {
    const messages = [
      claudeMsg({ agentIdentity: { provider: "local-ollama", displayName: "Qwen 2.5" } }),
    ];
    const { container } = renderChat(messages);
    const style = authorStyle(container, "m1");
    expect(style).toContain("var(--tandem-agent-local-ollama)");
    // The distinct fallbacks matter: it must NOT collapse to the accent baseline
    // nor to the annotation coral token.
    expect(style).not.toContain("var(--tandem-accent)");
    expect(style).not.toContain("var(--tandem-author-claude)");
    expect(bubble(container, "m1").classList).toContain("identified");
    expect(bubble(container, "m1").style.getPropertyValue("--chat-agent-color")).toBe(
      "var(--tandem-agent-local-ollama)",
    );
  });

  it("a claude message WITHOUT agentIdentity uses the coral author tokens", () => {
    const { container } = renderChat([claudeMsg()]);
    const style = authorStyle(container, "m1");
    expect(style).toContain("var(--tandem-author-claude-fg-strong)");
    expect(style).not.toContain("color: var(--tandem-author-claude);");
    expect(style).not.toContain("var(--tandem-accent)");
    expect(style).not.toContain("var(--tandem-agent-");
    expect(bubble(container, "m1").classList).toContain("claude");
    expect(bubble(container, "m1").classList).not.toContain("identified");
    expect(bubble(container, "m1").style.getPropertyValue("--chat-agent-color")).toBe(
      "var(--tandem-author-claude)",
    );
  });

  it("a user message uses the muted token, unaffected by identity wiring", () => {
    const { container } = renderChat([claudeMsg({ id: "u1", author: "user", text: "hi" })]);
    expect(authorStyle(container, "u1")).toContain("var(--tandem-fg-muted)");
  });

  it("disables per-message insertion when the App reports no editable formatted document", () => {
    const view = renderChat([claudeMsg()]);
    const button = view.container.querySelector<HTMLButtonElement>(".chat-message-actions button");
    expect(button?.disabled).toBe(true);
  });
});

/**
 * `ChatPanel.svelte:372` is one of the two `{@html}` sinks in the client — the
 * other is `AnnotationBody.svelte:73`, added by #1626 — and `renderMarkdown`
 * exists solely to make them safe. Nothing else pins that this one still routes
 * through it — a refactor to `{@html msg.text}` keeps every
 * test in `chat-markdown.test.ts` green while shipping an XSS, because those
 * tests exercise the function directly and never assert that anyone calls it.
 *
 * This is the wiring test. It asserts the rendered DOM, so it fails on the
 * refactor regardless of how the markup is spelled.
 */
describe("ChatPanel — the {@html} sink is routed through renderMarkdown", () => {
  it("does not build a script element from a claude message", () => {
    const view = renderChat([claudeMsg({ text: "<script>alert(1)</script>" })]);

    expect(view.container.querySelectorAll("script")).toHaveLength(0);
    expect(view.container.textContent).toContain("<script>alert(1)</script>");
  });

  it("does not build an event-handler attribute from a claude message", () => {
    const view = renderChat([claudeMsg({ text: '<img src=x onerror="alert(1)">' })]);

    expect(view.container.querySelectorAll("img")).toHaveLength(0);
    for (const el of Array.from(view.container.querySelectorAll("*"))) {
      expect(el.getAttributeNames().filter((n) => n.toLowerCase().startsWith("on"))).toEqual([]);
    }
  });

  it("still renders markdown for a claude message, so the sink is genuinely live", () => {
    // Without this arm the two above would also pass on a plain-text render,
    // which is the wrong fix for the right reason.
    const view = renderChat([claudeMsg({ text: "**bold**" })]);

    expect(view.container.querySelector(".chat-markdown strong")?.textContent).toBe("bold");
  });

  it("renders a user message as plain text, markup and all", () => {
    const view = renderChat([claudeMsg({ id: "u1", author: "user", text: "**not bold**" })]);

    expect(view.container.querySelector("strong")).toBeNull();
    expect(view.container.textContent).toContain("**not bold**");
  });
});

describe("ChatPanel — Tandem's Claude Start / Turn off control (#2195)", () => {
  function renderWithControl(control: "start" | "turn-off" | null, messages: ChatMessage[] = []) {
    const onStartClaude = vi.fn();
    const onTurnOffClaude = vi.fn();
    const result = render(ChatPanel, {
      props: {
        messages,
        editor: null,
        activeDocId: null,
        openDocs: [],
        capturedAnchor: null,
        onCapturedAnchorChange: () => {},
        onSend: () => true,
        onClear: async () => {},
        onExport: async () => {},
        onInsert: () => false,
        tandemClaudeControl: control,
        onStartClaude,
        onTurnOffClaude,
        tandemClaudeResume: null,
        onResumeRemedy: () => {},
      },
    });
    const btn = result.container.querySelector<HTMLButtonElement>(
      "[data-testid='chat-tandem-claude-toggle']",
    );
    return { ...result, btn, onStartClaude, onTurnOffClaude };
  }

  it("shows Start on an EMPTY chat — where it is most needed — and calls onStartClaude", () => {
    const { btn, onStartClaude, onTurnOffClaude, container } = renderWithControl("start");
    expect(btn).not.toBeNull();
    expect(btn?.textContent?.trim()).toBe("Start Tandem's Claude");
    btn?.click();
    expect(onStartClaude).toHaveBeenCalledOnce();
    expect(onTurnOffClaude).not.toHaveBeenCalled();
    // Export/Clear stay tied to there being messages.
    expect(container.querySelector("[data-testid='clear-chat-btn']")).toBeNull();
  });

  it("shows Turn off while it runs, naming Tandem's Claude", () => {
    const { btn, onTurnOffClaude } = renderWithControl("turn-off", [claudeMsg()]);
    expect(btn?.textContent?.trim()).toBe("Turn off Tandem's Claude");
    btn?.click();
    expect(onTurnOffClaude).toHaveBeenCalledOnce();
  });

  it("is absent when there is nothing to start or stop", () => {
    expect(renderWithControl(null).btn).toBeNull();
  });
});

describe("ChatPanel — the resume row (#2196)", () => {
  function renderWithResume(resume: ChatResume | null, messages: ChatMessage[] = []) {
    const onResumeRemedy = vi.fn();
    const result = render(ChatPanel, {
      props: {
        messages,
        editor: null,
        activeDocId: null,
        openDocs: [],
        capturedAnchor: null,
        onCapturedAnchorChange: () => {},
        onSend: () => true,
        onClear: async () => {},
        onExport: async () => {},
        onInsert: () => false,
        tandemClaudeControl: null,
        onStartClaude: () => {},
        onTurnOffClaude: () => {},
        tandemClaudeResume: resume,
        onResumeRemedy,
      },
    });
    const q = (id: string) => result.container.querySelector<HTMLElement>(`[data-testid='${id}']`);
    return { ...result, q, onResumeRemedy };
  }

  const unread = (): ChatMessage =>
    claudeMsg({ id: "u1", author: "user", text: "are you there?", timestamp: Date.now() });

  it("resuming replaces the pickup row, and the one live region says resuming", () => {
    // Positive control: the same unread message shows the pickup row with no resume.
    expect(renderWithResume(null, [unread()]).q("chat-pickup-status")).not.toBeNull();
    cleanup();
    const { q } = renderWithResume({ kind: "resuming", verb: "resuming" }, [unread()]);
    expect(q("chat-tandem-claude-resuming")?.textContent).toContain("Claude is resuming…");
    expect(q("chat-pickup-status")).toBeNull();
    expect(q("chat-pickup-live")?.textContent).toContain("Claude is resuming…");
  });

  it("says starting for a Claude that was off", () => {
    const { q } = renderWithResume({ kind: "resuming", verb: "starting" });
    expect(q("chat-tandem-claude-resuming")?.textContent).toContain("Starting Tandem's Claude…");
  });

  it("a failed start says the message is unanswered and its button runs the remedy", () => {
    const { q, onResumeRemedy } = renderWithResume({ kind: "failed", remedy: "sign-in" }, [
      unread(),
    ]);
    const row = q("chat-tandem-claude-resume-failed");
    expect(row?.textContent).toContain("hasn't been answered");
    expect(q("chat-pickup-status")).toBeNull();
    const btn = q("chat-tandem-claude-resume-remedy") as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe(AI_CTA["sign-in"].label);
    btn.click();
    expect(onResumeRemedy).toHaveBeenCalledWith("sign-in");
  });
});
