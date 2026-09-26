import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./styles.css";
import { DmApp } from "./dm/DmApp";
import { PlayerApp } from "./player/PlayerApp";

// Both windows load the same bundle; the window label decides which UI to show.
const label = getCurrentWebviewWindow().label;
document.documentElement.dataset.window = label;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{label === "player" ? <PlayerApp /> : <DmApp />}</React.StrictMode>,
);
