/**
 * "Not if another AI is on" (#2196) rests on one line in `src/server/index.ts`:
 * the supervisor's `otherAiAttached` seam defaults to `() => false`, because
 * the registry it reads lives in `mcp/server.ts`, which the supervisor must not
 * import. Without the wiring every behavioural test still passes — they inject
 * the seam — while production starts a second Claude beside the user's own.
 * So the wiring is pinned from source.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const INDEX = fs.readFileSync(
  path.join(import.meta.dirname, "../../../src/server/index.ts"),
  "utf8",
);

describe("index.ts wires the launcher's other-AI check", () => {
  it("passes the real registry check into the one createSupervisor call", () => {
    const calls = INDEX.match(/createSupervisor\(\{[\s\S]*?\}\);/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\botherAiAttached: isOtherMcpClientLive,/);
  });

  it("imports it from mcp/server.js", () => {
    expect(INDEX).toMatch(
      /import \{[^}]*\bisOtherMcpClientLive\b[^}]*\} from "\.\/mcp\/server\.js";/,
    );
  });
});
