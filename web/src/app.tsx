// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { Palette } from "./components/Palette";
import { Shell } from "./components/Shell";
import { AddDevicePage } from "./control/AddDevice";
import { PairPage } from "./control/Pair";
import { useAnswerableCount, useAppState } from "./data/hooks";
import { titlePrefix, useAttentionEffects } from "./lib/notify";
import { navigate, useRoute } from "./lib/router";
import { Board } from "./pages/Board";
import { Connect } from "./pages/Connect";
import { Feed } from "./pages/Feed";
import { Inbox } from "./pages/Inbox";
import { Machines } from "./pages/Machines";
import { Review } from "./pages/Review";
import { SessionPage } from "./pages/Session";
import { Setup } from "./pages/Setup";
import { Themes } from "./pages/Themes";
import { markSetupSeen, setupSeen, useSetupStatus } from "./setup/api";
import { needsSetup } from "./setup/steps";
import { fetchThemes, useThemes } from "./themes/host/registry";
import { ThemePage } from "./themes/host/ThemePage";

const TITLES: Record<string, string> = {
  board: "Board",
  inbox: "Inbox",
  feed: "Feed",
  review: "Review",
  machines: "Machines",
  connect: "Connect",
  setup: "Setup",
  session: "Session",
  pair: "Pair a machine",
  "add-device": "Add this device",
  themes: "Views",
};

export function App() {
  const route = useRoute();
  const { connection } = useAppState();
  const { themes } = useThemes();
  const themeName = route.name === "theme" ? themes.find((t) => t.id === route.id)?.name : undefined;
  // "(n) " ahead of every title while n answerable prompts are open (lib/notify.ts).
  const open = useAnswerableCount();
  useAttentionEffects();
  useEffect(() => {
    document.title = `${titlePrefix(open)}${themeName ?? TITLES[route.name] ?? "sessionpipe"} · sessionpipe gui`;
  }, [route, themeName, open]);
  useEffect(() => {
    if (route.name !== "session") window.scrollTo({ top: 0 });
  }, [route]);
  // The installed themes: at boot, and again each time the stream (re)connects, since a
  // reconnect may follow a restart with themes added or removed.
  useEffect(() => {
    if (connection === "live") void fetchThemes();
  }, [connection]);
  useEffect(() => {
    void fetchThemes();
  }, []);
  // First run: a brand-new machine (no event yet, TLS mode off, or its daemon not paired)
  // lands on /setup once per device; "Skip setup" or the first visit remembers it.
  const setup = useSetupStatus();
  useEffect(() => {
    if (route.name !== "board" || setup.local !== true || !setup.status) return;
    if (!needsSetup(setup.status) || setupSeen()) return;
    markSetupSeen();
    navigate("/setup", { replace: true });
  }, [route.name, setup.local, setup.status]);
  return (
    <Shell route={route}>
      {route.name === "board" && <Board />}
      {route.name === "inbox" && <Inbox />}
      {route.name === "session" && (
        <SessionPage key={`${route.harness}:${route.id}`} harness={route.harness} id={route.id} />
      )}
      {route.name === "feed" && <Feed />}
      {route.name === "review" && <Review />}
      {route.name === "machines" && <Machines />}
      {route.name === "connect" && <Connect />}
      {route.name === "setup" && <Setup />}
      {route.name === "themes" && <Themes />}
      {route.name === "theme" && <ThemePage key={route.id} id={route.id} />}
      {route.name === "pair" && <PairPage key={route.code} code={route.code} />}
      {route.name === "add-device" && <AddDevicePage />}
      {route.name === "missing" && (
        <div className="page">
          <p className="page-note">Nothing at {route.path}.</p>
        </div>
      )}
      <Palette />
    </Shell>
  );
}
