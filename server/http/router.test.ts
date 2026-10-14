import { describe, expect, it } from "vitest";
import { Router } from "./router.js";

describe("Router", () => {
  it("matches params and wildcards", () => {
    const r = new Router();
    r.get("/api/ui/sessions/:harness/:id", () => ({ status: 200 }));
    r.get("/static/*path", () => ({ status: 200 }));
    expect(r.match("GET", "/api/ui/sessions/claude-code/abc")?.params).toEqual({ harness: "claude-code", id: "abc" });
    expect(r.match("GET", "/static/a/b.js")?.params).toEqual({ path: "a/b.js" });
    expect(r.match("POST", "/api/ui/sessions/x/y")).toMatchObject({ params: {} });
    expect(r.match("GET", "/nope")).toBeNull();
  });
});
