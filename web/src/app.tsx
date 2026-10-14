// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { Shell } from "./components/Shell";
import { PairPage } from "./control/Pair";
import { useRoute } from "./lib/router";
import { Board } from "./pages/Board";
import { Connect } from "./pages/Connect";
import { Feed } from "./pages/Feed";
import { Machines } from "./pages/Machines";
import { SessionPage } from "./pages/Session";
import { OfficePage } from "./themes/office/Office";

const TITLES: Record<string, string> = {
  board: "Board",
  feed: "Feed",
  machines: "Machines",
  connect: "Connect",
  session: "Session",
  pair: "Pair a machine",
  office: "Office",
};

export function App() {
  const route = useRoute();
  useEffect(() => {
    document.title = `${TITLES[route.name] ?? "sessionpipe"} · sessionpipe`;
    if (route.name !== "session") window.scrollTo({ top: 0 });
  }, [route]);
  return (
    <Shell route={route}>
      {route.name === "board" && <Board />}
      {route.name === "session" && (
        <SessionPage key={`${route.harness}:${route.id}`} harness={route.harness} id={route.id} />
      )}
      {route.name === "feed" && <Feed />}
      {route.name === "machines" && <Machines />}
      {route.name === "connect" && <Connect />}
      {route.name === "office" && <OfficePage />}
      {route.name === "pair" && <PairPage key={route.code} code={route.code} />}
      {route.name === "missing" && (
        <div className="page">
          <p className="page-note">Nothing at {route.path}.</p>
        </div>
      )}
    </Shell>
  );
}
