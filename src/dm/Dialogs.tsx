import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Group, Image as KImage, Layer, Rect, Stage } from "react-konva";
import type { BackgroundImage, ImageRect, Level } from "../types";
import { useDoc } from "../store/doc";
import { useUi } from "../store/ui";
import { assetUrl, backend } from "../lib/backend";
import { fitBox, round3 } from "../lib/geometry";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Modal, NumberField } from "../components/ui";
import { CELL, GridLines, useImageElement, useViewTransform } from "../map/common";

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  const dungeon = useDoc((s) => s.dungeon);
  const close = () => useUi.getState().set({ dialog: null });
  if (!dialog || !dungeon) return null;
  switch (dialog.type) {
    case "addLevel":
      return <LevelDialog onClose={close} />;
    case "editLevel": {
      const level = dungeon.levels.find((l) => l.id === dialog.levelId);
      return level ? <LevelDialog level={level} onClose={close} /> : null;
    }
    case "levelDescription": {
      const level = dungeon.levels.find((l) => l.id === dialog.levelId);
      if (!level) return null;
      return (
        <DocDialog
          title={`${level.name} — level description`}
          value={level.description}
          onChange={(md) => useDoc.getState().updateLevel(level.id, { description: md }, `level-desc-${level.id}`)}
          onClose={close}
        />
      );
    }
    case "background":
      return (
        <DocDialog
          title={`${dungeon.name} — background`}
          value={dungeon.background}
          onChange={(md) => useDoc.getState().setBackground(md)}
          onClose={close}
        />
      );
  }
}

function DocDialog({
  title,
  value,
  onChange,
  onClose,
}: {
  title: string;
  value: string;
  onChange: (md: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      size="large"
      onClose={onClose}
      footer={
        <>
          <span className="hint grow">Changes are saved automatically. ⌘/Ctrl-click a link to open it in your browser.</span>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <MarkdownEditor value={value} onChange={onChange} className="tall" autoFocus placeholder="Start writing…" />
    </Modal>
  );
}

// ---- add / edit level --------------------------------------------------------

const fullGrid = (w: number, h: number): ImageRect => ({ x: 0, y: 0, width: w, height: h });

function sameRect(a: ImageRect, b: ImageRect) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function LevelDialog({ level, onClose }: { level?: Level; onClose: () => void }) {
  const dungeon = useDoc((s) => s.dungeon)!;
  const [name, setName] = useState(level?.name ?? `Level ${dungeon.levels.length + 1}`);
  const [width, setWidth] = useState(level?.width ?? 30);
  const [height, setHeight] = useState(level?.height ?? 30);
  const [scale, setScale] = useState(level?.scale ?? 5);
  const [description, setDescription] = useState("");
  const [dmImage, setDmImage] = useState<BackgroundImage | null>(level?.dmImage ?? null);
  const [playerImage, setPlayerImage] = useState<BackgroundImage | null>(level?.playerImage ?? null);
  const [calibrating, setCalibrating] = useState<"dm" | "player" | null>(null);

  // Images that were stretched to the old grid follow a resize.
  const resize = (w: number, h: number) => {
    const adjust = (img: BackgroundImage | null) =>
      img && sameRect(img.rect, fullGrid(width, height)) ? { ...img, rect: fullGrid(w, h) } : img;
    setDmImage(adjust);
    setPlayerImage(adjust);
    setWidth(w);
    setHeight(h);
  };

  const save = () => {
    const doc = useDoc.getState();
    const fields = { name: name.trim() || "Unnamed level", width, height, scale, dmImage, playerImage };
    if (level) {
      doc.updateLevel(level.id, fields);
    } else {
      const id = doc.addLevel({ ...fields, description });
      useUi.getState().set({ currentLevelId: id, selection: null, draw: null });
    }
    onClose();
  };

  if (calibrating) {
    const img = calibrating === "dm" ? dmImage : playerImage;
    const setImg = calibrating === "dm" ? setDmImage : setPlayerImage;
    if (img) {
      return (
        <CalibrationDialog
          image={img}
          gridWidth={width}
          gridHeight={height}
          onCancel={() => setCalibrating(null)}
          onDone={(rect) => {
            setImg({ ...img, rect });
            setCalibrating(null);
          }}
        />
      );
    }
  }

  return (
    <Modal
      title={level ? `Edit level — ${level.name}` : "Add a level"}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            {level ? "Save" : "Add level"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="row">
          <label>
            Width (squares)
            <NumberField value={width} min={1} max={1000} integer onCommit={(w) => resize(w, height)} />
          </label>
          <label>
            Height (squares)
            <NumberField value={height} min={1} max={1000} integer onCommit={(h) => resize(width, h)} />
          </label>
          <label>
            Scale (ft / square)
            <NumberField value={scale} min={0.1} max={1000} step={0.5} onCommit={setScale} />
          </label>
        </div>
        <p className="hint">
          {width}×{height} squares = {round3(width * scale)}×{round3(height * scale)} ft. Changing the size does not move
          existing rooms.
        </p>
        <ImagePicker
          label="DM background image"
          hint="Shown only in your window."
          image={dmImage}
          grid={{ width, height }}
          onChange={setDmImage}
          onCalibrate={() => setCalibrating("dm")}
        />
        <ImagePicker
          label="Player background image"
          hint="Shown to players inside revealed rooms only."
          image={playerImage}
          grid={{ width, height }}
          onChange={setPlayerImage}
          onCalibrate={() => setCalibrating("player")}
          extra={
            dmImage && (
              <button type="button" onClick={() => setPlayerImage({ ...dmImage })} title="Use the DM image for players too">
                Same as DM image
              </button>
            )
          }
        />
        {!level && (
          <label>
            Level description
            <MarkdownEditor value={description} onChange={setDescription} placeholder="Optional — can be edited later" />
          </label>
        )}
      </div>
    </Modal>
  );
}

function ImagePicker({
  label,
  hint,
  image,
  grid,
  onChange,
  onCalibrate,
  extra,
}: {
  label: string;
  hint: string;
  image: BackgroundImage | null;
  grid: { width: number; height: number };
  onChange: (img: BackgroundImage | null) => void;
  onCalibrate: () => void;
  extra?: React.ReactNode;
}) {
  const dir = useUi((s) => s.dungeonDir)!;
  const [error, setError] = useState<string | null>(null);
  const choose = async () => {
    setError(null);
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"] }],
    });
    if (typeof picked !== "string") return;
    try {
      const path = await backend.importAsset(dir, picked);
      onChange({ path, rect: fullGrid(grid.width, grid.height) });
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="image-picker">
      <div className="image-picker-label">
        {label} <span className="hint">{hint}</span>
      </div>
      <div className="row">
        {image ? (
          <>
            <img className="thumb" src={assetUrl(dir, image.path)} alt="" />
            <span className="path" title={image.path}>
              {image.path.split("/").pop()}
            </span>
            <button type="button" onClick={onCalibrate} title="Align the image with the grid">
              Calibrate…
            </button>
            <button type="button" onClick={() => void choose()}>
              Replace…
            </button>
            <button type="button" onClick={() => onChange(null)}>
              Remove
            </button>
          </>
        ) : (
          <>
            <span className="muted">None</span>
            <button type="button" onClick={() => void choose()}>
              Choose image…
            </button>
          </>
        )}
        {extra}
      </div>
      {error && <div className="error small">{error}</div>}
    </div>
  );
}

// ---- background image calibration --------------------------------------------

function CalibrationDialog({
  image,
  gridWidth,
  gridHeight,
  onDone,
  onCancel,
}: {
  image: BackgroundImage;
  gridWidth: number;
  gridHeight: number;
  onDone: (rect: ImageRect) => void;
  onCancel: () => void;
}) {
  const dir = useUi((s) => s.dungeonDir)!;
  const img = useImageElement(assetUrl(dir, image.path));
  const [rect, setRect] = useState<ImageRect>(image.rect);
  const [lockAspect, setLockAspect] = useState(true);
  const [pps, setPps] = useState(100);
  const W = 760;
  const H = 480;
  const { view, onWheel, setView } = useViewTransform(
    fitBox({ x: -CELL, y: -CELL, width: (gridWidth + 2) * CELL, height: (gridHeight + 2) * CELL }, W, H, 0.02),
  );

  const r = (v: number) => round3(v);
  const setSize = (w: number, h: number, keepCenter = false) => {
    const next = { ...rect, width: r(w), height: r(h) };
    if (keepCenter) {
      next.x = r(rect.x + (rect.width - w) / 2);
      next.y = r(rect.y + (rect.height - h) / 2);
    }
    setRect(next);
  };
  const aspect = img ? img.naturalWidth / img.naturalHeight : rect.width / rect.height;
  const scaleBy = (f: number) => setSize(rect.width * f, rect.height * f, true);

  const fitKeepAspect = () => {
    const s = Math.min(gridWidth / aspect, gridHeight);
    const w = s * aspect;
    setRect({ x: r((gridWidth - w) / 2), y: r((gridHeight - s) / 2), width: r(w), height: r(s) });
  };

  return (
    <Modal
      title="Calibrate background image"
      size="large"
      onClose={onCancel}
      footer={
        <>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onDone(rect)}>
            Apply
          </button>
        </>
      }
    >
      <div className="calibration">
        <div className="calibration-stage" style={{ width: W, height: H }}>
          <Stage
            width={W}
            height={H}
            x={view.x}
            y={view.y}
            scaleX={view.scale}
            scaleY={view.scale}
            onWheel={onWheel}
            draggable
            onDragMove={(e) => {
              const st = e.target.getStage();
              if (st && e.target === st) setView({ ...view, x: st.x(), y: st.y() });
            }}
          >
            <Layer>
              {img && (
                <>
                  {/* Whole image faded: the part outside the grid will be cropped. */}
                  <KImage
                    image={img}
                    x={rect.x * CELL}
                    y={rect.y * CELL}
                    width={rect.width * CELL}
                    height={rect.height * CELL}
                    opacity={0.3}
                    draggable
                    onDragMove={(e) => {
                      setRect({ ...rect, x: r(e.target.x() / CELL), y: r(e.target.y() / CELL) });
                    }}
                  />
                  <Group clip={{ x: 0, y: 0, width: gridWidth * CELL, height: gridHeight * CELL }} listening={false}>
                    <KImage
                      image={img}
                      x={rect.x * CELL}
                      y={rect.y * CELL}
                      width={rect.width * CELL}
                      height={rect.height * CELL}
                    />
                  </Group>
                </>
              )}
              <GridLines width={gridWidth} height={gridHeight} color="rgba(255,60,60,0.8)" viewScale={view.scale} />
              <Rect
                width={gridWidth * CELL}
                height={gridHeight * CELL}
                stroke="#ff3c3c"
                strokeWidth={3}
                strokeScaleEnabled={false}
                listening={false}
              />
            </Layer>
          </Stage>
        </div>
        <div className="calibration-controls">
          <p className="hint">
            Drag the image to move it, scroll to zoom the view. Line up the image's grid with the red grid; anything
            outside the red border is cropped.
          </p>
          <div className="row">
            <label>
              X offset
              <NumberField value={rect.x} step={0.05} onCommit={(x) => setRect({ ...rect, x })} />
            </label>
            <label>
              Y offset
              <NumberField value={rect.y} step={0.05} onCommit={(y) => setRect({ ...rect, y })} />
            </label>
          </div>
          <div className="row">
            <label>
              Width
              <NumberField
                value={rect.width}
                min={0.1}
                step={0.05}
                onCommit={(w) => setSize(w, lockAspect ? w * (rect.height / rect.width) : rect.height)}
              />
            </label>
            <label>
              Height
              <NumberField
                value={rect.height}
                min={0.1}
                step={0.05}
                onCommit={(h) => setSize(lockAspect ? h * (rect.width / rect.height) : rect.width, h)}
              />
            </label>
          </div>
          <label className="menu-check">
            <input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} /> Lock aspect
            ratio
          </label>
          <div className="row">
            <span>Scale</span>
            <button onClick={() => scaleBy(1 / 1.1)}>−10%</button>
            <button onClick={() => scaleBy(1 / 1.01)}>−1%</button>
            <button onClick={() => scaleBy(1.01)}>+1%</button>
            <button onClick={() => scaleBy(1.1)}>+10%</button>
          </div>
          {img && (
            <div className="row">
              <label>
                Image pixels per square
                <NumberField value={pps} min={1} onCommit={setPps} />
              </label>
              <button onClick={() => setSize(img.naturalWidth / pps, img.naturalHeight / pps)}>Apply</button>
            </div>
          )}
          <div className="row">
            <button onClick={() => setRect(fullGrid(gridWidth, gridHeight))}>Stretch to grid</button>
            <button onClick={fitKeepAspect}>Fit (keep aspect)</button>
          </div>
          {img && (
            <p className="hint">
              Image: {img.naturalWidth}×{img.naturalHeight}px · Grid: {gridWidth}×{gridHeight} squares
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
