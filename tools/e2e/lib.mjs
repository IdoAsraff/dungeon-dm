/**
 * Helpers for e2e driver scripts: start headless Chrome, open the harness
 * (DM + player iframes, mocked backend), run code inside a window, send real
 * mouse/keyboard input, take screenshots. See docs/testing.md.
 *
 *   import { startHarness } from "./lib.mjs";
 *   const h = await startHarness();          // opens the sample dungeon in the DM window
 *   h.check(await h.dm(`return !!document.querySelector(".dm-map-area")`), "map shows");
 *   await h.done();
 *
 * Needs the Vite dev server on port 1420 (`npx vite --port 1420 --strictPort`) and
 * Google Chrome. Both must run outside the Claude Code sandbox.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SHOTS = path.join(here, "shots");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.E2E_URL ?? "http://localhost:1420";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const META = 4;
export const SHIFT = 8;
export const ALT = 1;
/** Screen regions of the two iframes (for screenshots). */
export const DM_CLIP = { x: 0, y: 0, width: 1400, height: 860 };
export const PLAYER_CLIP = { x: 0, y: 866, width: 960, height: 600 };

/**
 * @param {object} [opts]
 * @param {"connected"|"connect"} [opts.spotify] logged in to the fake Spotify, or on the Connect screen
 * @param {boolean} [opts.open] click the sample dungeon on the start screen (default true)
 * @param {(fx: {dungeon: Record<string,string>, notes: Record<string,string>, attachments: string[]}) => void} [opts.patch]
 *   change the fixture before the app loads it (written to fx/files.json)
 */
export async function startHarness(opts = {}) {
  const { spotify = "connected", open = true, patch } = opts;
  const fxFile = path.join(here, "fx/files.json");
  if (!fs.existsSync(fxFile)) throw new Error("No fixture: run `node tools/e2e/fixture.mjs` first.");
  if (patch) {
    const fx = JSON.parse(fs.readFileSync(fxFile, "utf8"));
    patch(fx);
    fs.writeFileSync(fxFile, JSON.stringify(fx));
  }
  try {
    await fetch(`${BASE}/tools/e2e/index.html`);
  } catch {
    throw new Error(`Vite is not running on ${BASE}: start it with \`npx vite --port 1420 --strictPort\` (outside the sandbox).`);
  }
  fs.mkdirSync(SHOTS, { recursive: true });

  const port = 9300 + Math.floor(Math.random() * 600);
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(here, ".chrome-profile")}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
  if (!version) throw new Error("Chrome did not start (is it installed, and are you outside the sandbox?)");
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let nextId = 1;
  const pending = new Map();
  /** Console errors/warnings and uncaught exceptions from both windows. */
  const logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (!/callback id|Couldn't find callback/.test(text)) logs.push(`[${msg.params.type}] ${text}`);
    }
    if (msg.method === "Runtime.exceptionThrown") logs.push(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  };
  /** Raw Chrome DevTools Protocol command. */
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1420, height: 1480, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/tools/e2e/index.html?spotify=${spotify}` });
  await sleep(2500);

  /** Runs `js` (a function body; may `await` and `return` a JSON value) inside a window. */
  const inFrame = async (frame, js) => {
    const expr = `(async () => { const w = document.getElementById(${JSON.stringify(frame)}).contentWindow; return await w.eval(${JSON.stringify(`(async () => { ${js} })()`)}); })()`;
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n${js}`);
    return r.result.value;
  };
  const dm = (js) => inFrame("dm", js);
  const player = (js) => inFrame("player", js);
  /** Runs `js` in the harness page itself (window.__saved, __playerData, __fake, __settings...). */
  const top = async (js) => {
    const r = await send("Runtime.evaluate", { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };

  let failures = 0;
  const check = (cond, msg) => {
    console.log(cond ? "PASS" : "FAIL", msg);
    if (!cond) failures++;
  };
  /** Polls `js` in the DM window until it returns something truthy. */
  const waitFor = async (js, ms = 4000, frame = "dm") => {
    for (let t = 0; t < ms; t += 100) {
      const v = await inFrame(frame, js);
      if (v) return v;
      await sleep(100);
    }
    return false;
  };
  const shot = async (name, clip) => {
    const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    const file = path.join(SHOTS, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    console.log("screenshot", file);
    return file;
  };
  /** Screen position (page coordinates) of the first DM element matching selector (and containing text). */
  const locate = async (selector, text = "", frame = "dm") => {
    const r = await inFrame(frame, `const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)}));
      if (!el) throw new Error("not found: " + ${JSON.stringify(`${selector} ${text}`)});
      el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, width: b.width, height: b.height };`);
    const offsetY = frame === "player" ? PLAYER_CLIP.y : 0;
    return { ...r, y: r.y + offsetY };
  };
  const mouse = async (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", ...extra });
  /** A real click (mouse events) at page coordinates. */
  const clickAt = async (x, y, { modifiers = 0, clickCount = 1 } = {}) => {
    await mouse("mouseMoved", x, y, { button: "none", modifiers });
    await mouse("mousePressed", x, y, { buttons: 1, clickCount, modifiers });
    await mouse("mouseReleased", x, y, { buttons: 0, clickCount, modifiers });
  };
  /** A real click on the element matching selector (and containing text). */
  const click = async (selector, text = "", opts = {}) => {
    const p = await locate(selector, text, opts.frame);
    await clickAt(p.x, p.y, opts);
  };
  /** Drags with the mouse from one page point to another in `steps` moves. */
  const drag = async (from, to, steps = 8) => {
    await mouse("mouseMoved", from.x, from.y, { button: "none" });
    await mouse("mousePressed", from.x, from.y, { buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) await mouse("mouseMoved", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { buttons: 1 });
    await mouse("mouseReleased", to.x, to.y, { buttons: 0, clickCount: 1 });
  };
  /** Gives keyboard focus to the DM window (needed before `key`). */
  const focusDm = () => top(`document.getElementById("dm").focus(); document.getElementById("dm").contentWindow.focus(); return 1`);
  /** Presses a key: key("4", META, "Digit4") is ⌘4; key("Escape") is Esc. */
  const key = async (k, modifiers = 0, code) => {
    code ??= k.length === 1 ? (/\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`) : k;
    const vk = k.length === 1 ? k.toUpperCase().charCodeAt(0) : { Enter: 13, Escape: 27, Tab: 9, Backspace: 8 }[k] ?? 0;
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, modifiers, windowsVirtualKeyCode: vk, ...(k === "Enter" ? { text: "\r" } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, modifiers, windowsVirtualKeyCode: vk });
  };
  /** Types text into whatever has focus. */
  const type = (text) => send("Input.insertText", { text });
  /** The DM map's Konva stage transform (to turn grid coordinates into screen points). */
  const dmStage = () => dm(`const st = window.Konva.stages.find(s => s.container().closest(".dm-map-area"));
    const b = st.container().getBoundingClientRect();
    return { left: b.left, top: b.top, x: st.x(), y: st.y(), scale: st.scaleX() };`);

  /** Prints collected console errors, closes Chrome and sets the exit code. */
  const done = async () => {
    for (const l of logs) console.log(l);
    ws.close();
    chrome.kill();
    if (failures) process.exitCode = 1;
    console.log(process.exitCode ? `FAILED (${failures} check(s) failed${failures ? "" : ", or an error"})` : "all checks passed");
  };

  const h = { send, dm, player, top, check, waitFor, shot, locate, click, clickAt, drag, focusDm, key, type, dmStage, sleep, logs, done };
  if (open) {
    await click(".recent-list button", "fx");
    if (!(await waitFor(`return !!document.querySelector(".dm-root")`))) throw new Error("the dungeon did not open");
    await sleep(800);
    await focusDm();
  }
  return h;
}

/** Runs a driver body with a harness, screenshots on error and always cleans up. */
export async function run(body, opts) {
  let h;
  try {
    h = await startHarness(opts);
    await body(h);
  } catch (e) {
    console.log("ERROR", e.message);
    process.exitCode = 1;
    await h?.shot("error").catch(() => {});
  } finally {
    await h?.done();
  }
}
