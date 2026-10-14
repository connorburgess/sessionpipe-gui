// SPDX-License-Identifier: Apache-2.0
// /s/:harness/:id — one session as a page: the SessionView scrolling the window, with
// its own title row. The same view opens beside any page in the side panel
// (components/SessionPanel.tsx).
import { SessionView } from "../components/SessionView";

export function SessionPage({ harness, id }: { harness: string; id: string }) {
  return <SessionView harness={harness} id={id} mode="page" />;
}
