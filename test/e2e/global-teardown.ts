// SPDX-License-Identifier: Apache-2.0
// After the run: remove the fresh state dir the demo server wrote to (playwright.config.ts
// names it and hands it over in SPGUI_E2E_STATE).
import { rmSync } from "node:fs";

export default function globalTeardown(): void {
  for (const dir of [process.env.SPGUI_E2E_STATE, process.env.SPGUI_E2E_TLS_STATE]) {
    if (dir?.includes("spgui-e2e-")) rmSync(dir, { recursive: true, force: true });
  }
}
