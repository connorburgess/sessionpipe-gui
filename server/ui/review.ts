// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core. The Review page's routes: search, files changed, daily digest.
// Read-only readings of the index (store/review.ts); registered by registerUi with its guard.
import { type DigestQuery, type FilesQuery, ROUTES, type SearchQuery } from "../../shared/api.js";
import type { Ctx, Handler, Reply, Router } from "../http/router.js";
import type { Store } from "../store/store.js";

export function registerReview(router: Router, store: Store, guard: (h: Handler) => Handler): void {
  router.get(
    ROUTES.ui.search,
    guard((ctx): Reply => {
      const p = ctx.url.searchParams;
      const q: SearchQuery = { q: p.get("q") ?? "" };
      const limit = intParam(ctx, "limit");
      if (limit !== undefined) q.limit = limit;
      const before = p.get("before");
      if (before) q.before = before;
      return { status: 200, json: store.search(q), headers: { "cache-control": "no-store" } };
    }),
  );

  router.get(
    ROUTES.ui.files,
    guard((ctx): Reply => {
      const p = ctx.url.searchParams;
      const q: FilesQuery = {};
      const since = p.get("since");
      if (since) {
        if (!Number.isFinite(Date.parse(since))) return { status: 400, json: { reason: "bad_since" } };
        q.since = since;
      }
      const repo = p.get("repo");
      if (repo) q.repo = repo;
      return { status: 200, json: store.filesChanged(q), headers: { "cache-control": "no-store" } };
    }),
  );

  router.get(
    ROUTES.ui.digest,
    guard((ctx): Reply => {
      const p = ctx.url.searchParams;
      const q: DigestQuery = {};
      const day = p.get("day");
      if (day) q.day = day;
      const tz = intParam(ctx, "tz");
      if (p.get("tz") && tz === undefined) return { status: 400, json: { reason: "bad_tz" } };
      if (tz !== undefined) q.tz = tz;
      try {
        return { status: 200, json: store.digest(q), headers: { "cache-control": "no-store" } };
      } catch (e) {
        if (e instanceof RangeError) return { status: 400, json: { reason: "bad_day" } };
        throw e;
      }
    }),
  );
}

function intParam(ctx: Ctx, name: string): number | undefined {
  const v = ctx.url.searchParams.get(name);
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}
