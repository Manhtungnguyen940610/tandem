/**
 * Source pins for App's launcher wiring (#2195) — the two facts no type and no
 * mounted test can catch:
 *
 *   1. The chat panel is mounted through `PanelSlot`, whose loose
 *      `[key: string]: any` union arm accepts a mount that forgets ChatPanel's
 *      required props. The Start / Turn off control would then never render,
 *      and nothing would say so.
 *   2. The no-agent send toast is built inside App, which no test mounts. Its
 *      action must go through the `AiCtaAction` record: a binary
 *      `action === "restart" ? … : …` sends the `start` CTA to the integration
 *      wizard (#1268's bug class).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = readFileSync(join(import.meta.dirname, "../../src/client/App.svelte"), "utf8");

function chatMount(): string {
  const start = APP.indexOf('kind="chat"');
  expect(start, "App mounts a chat PanelSlot").toBeGreaterThan(-1);
  const end = APP.indexOf("/>", start);
  return APP.slice(start, end);
}

describe("App launcher wiring (#2195)", () => {
  it("the chat panel mount passes the Start / Turn off control and both handlers", () => {
    const mount = chatMount();
    expect(mount).toMatch(/tandemClaudeControl=\{tandemClaudeControl\}/);
    expect(mount).toMatch(/onStartClaude=\{startClaude\}/);
    expect(mount).toMatch(/onTurnOffClaude=\{turnOffClaude\}/);
  });

  it("the no-agent toast routes through the AiCtaAction record, never a binary ternary", () => {
    expect(APP).toMatch(/onClick: AI_CTA_HANDLERS\[AI_CTA\[notice\.chip\]\.action\]/);
    expect(APP).not.toMatch(/\.action === "restart" \?/);
  });

  it("the record maps start to the Start control", () => {
    expect(APP).toMatch(/start: startClaude,/);
  });
});

describe("App resume-row wiring (#2196)", () => {
  it("the chat panel mount passes the resume row and its remedy handler", () => {
    const mount = chatMount();
    expect(mount).toMatch(/\{tandemClaudeResume\}/);
    expect(mount).toMatch(/\{onResumeRemedy\}/);
  });

  it("a send notes the request BEFORE the addressed-ai dispatch whose toast reads it", () => {
    const send = APP.slice(APP.indexOf("function sendChatMessage("));
    const noted = send.indexOf("chatResumeState.noteSent();");
    const dispatched = send.indexOf('"tandem:addressed-ai"');
    expect(noted).toBeGreaterThan(-1);
    expect(dispatched).toBeGreaterThan(noted);
  });

  it("the no-agent toast stands aside for a chat that is starting Claude, and only for chat", () => {
    expect(APP).toMatch(/if \(viaKey === "chat" && chatResumeState\.pending\) return;/);
  });

  it("the remedy routes through the AiCtaAction record", () => {
    expect(APP).toMatch(/AI_CTA_HANDLERS\[AI_CTA\[remedy\]\.action\]\(\)/);
  });
});
