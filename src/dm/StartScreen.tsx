import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { backend } from "../lib/backend";
import { createDungeon, openDungeon } from "../lib/dungeonIO";
import { useUi } from "../store/ui";

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "dungeon"
  );
}

export function StartScreen() {
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    backend
      .getSettings()
      .then((s) => setRecent(s.recentDungeons))
      .catch((e) => setError(String(e)));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doOpen = (dir: string) =>
    run(async () => {
      const warnings = await openDungeon(dir);
      if (warnings.length) useUi.getState().showToast(warnings.join(" "));
    });

  const browse = () =>
    run(async () => {
      const dir = await openDialog({ directory: true, multiple: false, title: "Open a dungeon folder" });
      if (typeof dir !== "string") return;
      const warnings = await openDungeon(dir);
      if (warnings.length) useUi.getState().showToast(warnings.join(" "));
    });

  const create = () =>
    run(async () => {
      const name = newName.trim();
      if (!name) throw new Error("Give the new dungeon a name first.");
      const parent = await openDialog({
        directory: true,
        multiple: false,
        title: `Choose where to create the "${name}" folder`,
      });
      if (typeof parent !== "string") return;
      const dir = `${parent.replace(/[\\/]+$/, "")}/${slugify(name)}`;
      if (await backend.dungeonExists(dir)) throw new Error(`${dir} already contains a dungeon — open it instead.`);
      await createDungeon(dir, name);
    });

  return (
    <div className="start-screen">
      <div className="start-card">
        <h1>Dungeon DM</h1>
        <p className="muted">Choose a dungeon to run.</p>

        <section>
          <button className="primary big" disabled={busy} onClick={browse}>
            Open dungeon folder…
          </button>
        </section>

        {recent.length > 0 && (
          <section>
            <h3>Recent</h3>
            <ul className="recent-list">
              {recent.map((d) => (
                <li key={d}>
                  <button disabled={busy} onClick={() => doOpen(d)} title={d}>
                    <span className="recent-name">{d.split(/[\\/]/).pop()}</span>
                    <span className="recent-path">{d}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3>New dungeon</h3>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input placeholder="Dungeon name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button type="submit" disabled={busy}>
              Create…
            </button>
          </form>
          <p className="hint">A folder named after the dungeon is created in the location you pick.</p>
        </section>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
