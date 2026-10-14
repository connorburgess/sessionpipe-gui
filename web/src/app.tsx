// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { Shell } from "./components/Shell";
import { PairPage } from "./control/Pair";
import { useAppState } from "./data/hooks";
import { useRoute } from "./lib/router";
import { Board } from "./pages/Board";
import { Connect } from "./pages/Connect";
import { Feed } from "./pages/Feed";
import { Machines } from "./pages/Machines";
import { SessionPage } from "./pages/Session";
import { Themes } from "./pages/Themes";
import { fetchThemes, useThemes } from "./themes/host/registry";
import { ThemePage } from "./themes/host/ThemePage";

const TITLES: Record<string, string> = {
  board: "Board",
  feed: "Feed",
  machines: "Machines",
  connect: "Connect",
  session: "Session",
  pair: "Pair a machine",
  themes: "Themes",
};

export function App() {
  const route = useRoute();
  const { connection } = useAppState();
  const { themes } = useThemes();
  const themeName = route.name === "theme" ? themes.find((t) => t.id === route.id)?.name : undefined;
  useEffect(() => {
    document.title = `${themeName ?? TITLES[route.name] ?? "sessionpipe"} · sessionpipe`;
    if (route.name !== "session") window.scrollTo({ top: 0 });
  }, [route, themeName]);
  // The installed themes: at boot, and again each time the stream (re)connects, since a
  // reconnect may follow a restart with themes added or removed.
  useEffect(() => {
    if (connection === "live") void fetchThemes();
  }, [connection]);
  useEffect(() => {
    void fetchThemes();
  }, []);
  return (
    <Shell route={route}>
      {route.name === "board" && <Board />}
      {route.name === "session" && (
        <SessionPage key={`${route.harness}:${route.id}`} harness={route.harness} id={route.id} />
      )}
      {route.name === "feed" && <Feed />}
      {route.name === "machines" && <Machines />}
      {route.name === "connect" && <Connect />}
      {route.name === "themes" && <Themes />}
      {route.name === "theme" && <ThemePage key={route.id} id={route.id} />}
      {route.name === "pair" && <PairPage key={route.code} code={route.code} />}
      {route.name === "missing" && (
        <div className="page">
          <p className="page-note">Nothing at {route.path}.</p>
        </div>
      )}
    </Shell>
  );
}
