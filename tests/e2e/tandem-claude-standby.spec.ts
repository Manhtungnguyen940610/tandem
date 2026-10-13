import { expect, type Page, test } from "@playwright/test";
import { openChat } from "./helpers";

/**
 * Tandem's Claude stopped by choice (#2195): the status pill, the empty state
 * and the chat panel offer Start; the chat panel offers Turn off while it runs;
 * Settings saves the start mode as a partial patch.
 *
 * Everything launcher-shaped is stubbed. The E2E backend has no claude-code
 * integration (so its real supervisor reports `not-configured`), and the
 * backend is shared across spec files, whose MCP test clients leave a session
 * counted live for about a minute — which would promote readiness to `ready`
 * and hide every CTA. So `/health`, `/api/launcher/status`, the nonce and the
 * mutations are all routed before `page.goto`.
 */

async function stubLauncher(
  page: Page,
  status: Record<string, unknown>,
): Promise<{ posts: Array<{ url: string; body: Record<string, unknown> }> }> {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  await page.route("**/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        version: "test",
        transport: "http",
        hasSession: false,
        sessionCount: 0,
        push: { subscribers: 0, lastEventAt: null, eventCount: 0 },
      }),
    }),
  );
  await page.route("**/api/launcher/status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(status) }),
  );
  await page.route("**/api/launcher/nonce", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ nonce: "e2e-nonce" }),
    }),
  );
  for (const path of ["start", "settings"]) {
    await page.route(`**/api/launcher/${path}`, async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fallback();
      posts.push({ url: path, body: req.postDataJSON() as Record<string, unknown> });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          path === "start"
            ? { ok: true, started: true }
            : {
                ok: true,
                settings: { startMode: "off", lifetime: "always", idleMinutes: 30 },
              },
        ),
      });
    });
  }
  return { posts };
}

test("off: the pill says so and is the Start button", async ({ page }) => {
  const { posts } = await stubLauncher(page, {
    available: true,
    running: false,
    standby: "off",
  });
  await page.goto("/");
  const pill = page.locator("[data-testid='status-ai-indicator'][data-ai-state='standby']");
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await expect(pill).toContainText("Tandem's Claude is off");
  await expect(pill).toHaveAttribute("data-ai-action", "start");
  await pill.click();
  await expect
    .poll(() => posts.find((p) => p.url === "start")?.body)
    .toEqual({
      userInitiated: true,
      nonce: "e2e-nonce",
    });
});

test("the empty state offers Start, not Restart, for an idle-stopped Claude", async ({ page }) => {
  const { posts } = await stubLauncher(page, {
    available: true,
    running: false,
    standby: "idle",
  });
  await page.goto("/");
  const start = page.locator("[data-testid='empty-state-start-claude']");
  await expect(start).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-testid='empty-state-restart-claude']")).toHaveCount(0);
  await start.click();
  await expect.poll(() => posts.some((p) => p.url === "start")).toBe(true);
});

test("the chat panel's Start works on an empty chat", async ({ page }) => {
  const { posts } = await stubLauncher(page, {
    available: true,
    running: false,
    standby: "awaiting-start",
  });
  await page.goto("/");
  await page.waitForSelector("[data-testid='title-bar']", { timeout: 15_000 });
  await openChat(page);
  const toggle = page.locator("[data-testid='chat-tandem-claude-toggle']");
  await expect(toggle).toHaveAttribute("data-action", "start", { timeout: 15_000 });
  await toggle.click();
  await expect
    .poll(() => posts.find((p) => p.url === "start")?.body)
    .toMatchObject({
      userInitiated: true,
    });
});

test("the chat panel's Turn off sends startMode alone", async ({ page }) => {
  const { posts } = await stubLauncher(page, {
    available: true,
    running: true,
    reaperPid: 1,
    cwd: "/home/e2e",
    sessionId: "<set>",
    resuming: false,
    busy: false,
    attached: false,
  });
  await page.goto("/");
  await page.waitForSelector("[data-testid='title-bar']", { timeout: 15_000 });
  await openChat(page);
  const toggle = page.locator("[data-testid='chat-tandem-claude-toggle']");
  await expect(toggle).toHaveAttribute("data-action", "turn-off", { timeout: 15_000 });
  await toggle.click();
  await expect
    .poll(() => posts.find((p) => p.url === "settings")?.body)
    .toEqual({
      patch: { startMode: "off" },
      nonce: "e2e-nonce",
    });
});
