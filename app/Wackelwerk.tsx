"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  cloneGame,
  createBlankGame,
  createId,
  createSandboxTemplate,
  fitViewport,
  templates,
  validateGameDefinition,
  type BumperEntity,
  type EntityDefinition,
  type EntityType,
  type ForceEntity,
  type GameDefinition,
  type ObjectiveDefinition,
  type SpringEntity,
} from "../lib/game";
import {
  createGame,
  type GameController,
  type GameState,
} from "../lib/runtime";
import {
  createStandaloneHtml,
  downloadText,
} from "../lib/exporter";

type ViewMode = "edit" | "play";
type EntityPatch = Partial<EntityDefinition>;

const palette: {
  type: EntityType;
  icon: string;
  label: string;
  hint: string;
}[] = [
  { type: "platform", icon: "▬", label: "Plattform", hint: "Fester Halt" },
  { type: "bumper", icon: "●", label: "Stoßfänger", hint: "Prallt herrlich" },
  { type: "spring", icon: "⌁", label: "Sprungfläche", hint: "Boing nach oben" },
  { type: "force", icon: "↑", label: "Windzone", hint: "Schiebt und hebt" },
  { type: "collectible", icon: "✦", label: "Stoffknopf", hint: "Zum Einsammeln" },
  { type: "goal", icon: "⌂", label: "Zielzone", hint: "Weich landen" },
];

const typeLabels: Record<EntityType, string> = {
  platform: "Plattform",
  bumper: "Stoßfänger",
  spring: "Sprungfläche",
  force: "Windzone",
  collectible: "Stoffknopf",
  goal: "Zielzone",
};

const defaultsFor = (type: EntityType, index: number): EntityDefinition => {
  const base = {
    id: createId(type),
    x: 480 + ((index * 34) % 170) - 85,
    y: 270 + ((index * 22) % 110) - 55,
    angle: 0,
    label: typeLabels[type],
  };
  if (type === "platform") {
    return {
      ...base,
      type,
      width: 210,
      height: 24,
      color: "#355070",
    };
  }
  if (type === "bumper") {
    return {
      ...base,
      type,
      radius: 58,
      bounce: 1.1,
      color: "#2a9d8f",
    };
  }
  if (type === "spring") {
    return {
      ...base,
      type,
      width: 130,
      height: 24,
      impulse: 0.038,
      color: "#e76f51",
    };
  }
  if (type === "force") {
    return {
      ...base,
      type,
      width: 170,
      height: 250,
      forceX: 0,
      forceY: -0.0003,
      color: "#8ecae6",
    };
  }
  if (type === "collectible") {
    return {
      ...base,
      type,
      radius: 18,
      color: "#e9c46a",
    };
  }
  return {
    ...base,
    type,
    width: 220,
    height: 84,
    color: "#90be6d",
  };
};

const targetSize = (entity: EntityDefinition) => {
  if ("radius" in entity) {
    return { width: entity.radius * 2, height: entity.radius * 2 };
  }
  return { width: entity.width, height: entity.height };
};

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
};

function EditorCanvas({
  definition,
  selectedId,
  snap,
  onSelect,
  onGestureStart,
  onEntityPatch,
  onCharacterPatch,
}: {
  definition: GameDefinition;
  selectedId: string | null;
  snap: boolean;
  onSelect: (id: string | null) => void;
  onGestureStart: () => void;
  onEntityPatch: (
    id: string,
    patch: EntityPatch,
    checkpoint?: boolean,
  ) => void;
  onCharacterPatch: (
    patch: Partial<GameDefinition["character"]>,
    checkpoint?: boolean,
  ) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{
    id: string;
    mode: "move" | "resize";
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const fit = fitViewport(
      rect.width,
      rect.height,
      definition.viewport.width,
      definition.viewport.height,
    );
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(
      dpr * fit.scale,
      0,
      0,
      dpr * fit.scale,
      dpr * fit.offsetX,
      dpr * fit.offsetY,
    );
    ctx.fillStyle = definition.viewport.background;
    ctx.fillRect(0, 0, definition.viewport.width, definition.viewport.height);

    ctx.strokeStyle = "rgba(53,80,112,.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= definition.viewport.width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, definition.viewport.height);
      ctx.stroke();
    }
    for (let y = 0; y <= definition.viewport.height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(definition.viewport.width, y);
      ctx.stroke();
    }

    const rounded = (
      x: number,
      y: number,
      w: number,
      h: number,
      radius: number,
    ) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
    };

    definition.entities.forEach((entity) => {
      ctx.save();
      ctx.translate(entity.x, entity.y);
      ctx.rotate((entity.angle * Math.PI) / 180);
      if (entity.type === "bumper") {
        ctx.fillStyle = entity.color;
        ctx.beginPath();
        ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.76)";
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(4, entity.radius - 10), 0, Math.PI * 2);
        ctx.stroke();
      } else if (entity.type === "collectible") {
        ctx.fillStyle = entity.color;
        ctx.beginPath();
        ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.82)";
        for (const [x, y] of [
          [-5, -5],
          [5, -5],
          [-5, 5],
          [5, 5],
        ]) {
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (entity.type === "force") {
        ctx.fillStyle = `${entity.color}2d`;
        ctx.strokeStyle = entity.color;
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 8]);
        ctx.fillRect(
          -entity.width / 2,
          -entity.height / 2,
          entity.width,
          entity.height,
        );
        ctx.strokeRect(
          -entity.width / 2,
          -entity.height / 2,
          entity.width,
          entity.height,
        );
        ctx.setLineDash([]);
        ctx.fillStyle = entity.color;
        ctx.font = "800 20px sans-serif";
        ctx.textAlign = "center";
        for (
          let y = -entity.height / 2 + 32;
          y < entity.height / 2;
          y += 46
        ) {
          ctx.fillText("↑", 0, y);
        }
      } else if (entity.type === "goal") {
        ctx.fillStyle = `${entity.color}38`;
        ctx.strokeStyle = entity.color;
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);
        rounded(
          -entity.width / 2,
          -entity.height / 2,
          entity.width,
          entity.height,
          18,
        );
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = entity.color;
        ctx.font = "800 20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("ZIEL", 0, 7);
      } else {
        ctx.fillStyle = entity.color;
        rounded(
          -entity.width / 2,
          -entity.height / 2,
          entity.width,
          entity.height,
          Math.min(10, entity.height / 2),
        );
        ctx.fill();
        if (entity.type === "spring") {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (
            let x = -entity.width / 2 + 12;
            x < entity.width / 2 - 8;
            x += 18
          ) {
            ctx.moveTo(x, 5);
            ctx.lineTo(x + 9, -5);
            ctx.lineTo(x + 18, 5);
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    });

    const person = definition.character;
    const s = person.scale;
    const part = (
      x: number,
      y: number,
      w: number,
      h: number,
      color: string,
      angle = 0,
    ) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(44,45,54,.18)";
      ctx.lineWidth = 2;
      rounded(-w / 2, -h / 2, w, h, Math.min(w / 2, 9 * s));
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    part(
      person.x - 33 * s,
      person.y - 17 * s,
      16 * s,
      78 * s,
      person.sweater,
      0.16,
    );
    part(
      person.x + 33 * s,
      person.y - 17 * s,
      16 * s,
      78 * s,
      person.sweater,
      -0.16,
    );
    part(
      person.x - 14 * s,
      person.y + 58 * s,
      20 * s,
      100 * s,
      person.trousers,
      0.03,
    );
    part(
      person.x + 14 * s,
      person.y + 58 * s,
      20 * s,
      100 * s,
      person.trousers,
      -0.03,
    );
    part(
      person.x,
      person.y - 12 * s,
      46 * s,
      68 * s,
      person.sweater,
    );
    ctx.fillStyle = person.shoes;
    ctx.beginPath();
    ctx.ellipse(
      person.x - 18 * s,
      person.y + 111 * s,
      17 * s,
      9 * s,
      -0.12,
      0,
      Math.PI * 2,
    );
    ctx.ellipse(
      person.x + 18 * s,
      person.y + 111 * s,
      17 * s,
      9 * s,
      0.12,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = person.fabric;
    ctx.beginPath();
    ctx.arc(person.x, person.y - 65 * s, 21 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(61,48,39,.2)";
    ctx.stroke();
    ctx.fillStyle = "#3a3b45";
    ctx.beginPath();
    ctx.arc(person.x - 7 * s, person.y - 68 * s, 2.1 * s, 0, Math.PI * 2);
    ctx.arc(person.x + 7 * s, person.y - 68 * s, 2.1 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#665847";
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.arc(
      person.x,
      person.y - 63 * s,
      8 * s,
      0.2,
      Math.PI - 0.2,
    );
    ctx.stroke();

    if (selectedId) {
      const entity = definition.entities.find((item) => item.id === selectedId);
      const selection =
        selectedId === "ragdoll"
          ? {
              x: person.x,
              y: person.y + 18 * s,
              width: 112 * s,
              height: 202 * s,
            }
          : entity
            ? { x: entity.x, y: entity.y, ...targetSize(entity) }
            : null;
      if (selection) {
        ctx.save();
        ctx.strokeStyle = "#e76f51";
        ctx.lineWidth = 3 / fit.scale;
        ctx.setLineDash([8 / fit.scale, 5 / fit.scale]);
        ctx.strokeRect(
          selection.x - selection.width / 2 - 6 / fit.scale,
          selection.y - selection.height / 2 - 6 / fit.scale,
          selection.width + 12 / fit.scale,
          selection.height + 12 / fit.scale,
        );
        ctx.setLineDash([]);
        if (entity) {
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = "#e76f51";
          ctx.lineWidth = 3 / fit.scale;
          ctx.beginPath();
          ctx.rect(
            selection.x + selection.width / 2 - 6 / fit.scale,
            selection.y + selection.height / 2 - 6 / fit.scale,
            12 / fit.scale,
            12 / fit.scale,
          );
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }, [definition, selectedId]);

  useEffect(() => {
    paint();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [paint]);

  const toWorld = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const fit = fitViewport(
      rect.width,
      rect.height,
      definition.viewport.width,
      definition.viewport.height,
    );
    return {
      x: (event.clientX - rect.left - fit.offsetX) / fit.scale,
      y: (event.clientY - rect.top - fit.offsetY) / fit.scale,
      tolerance: 12 / fit.scale,
    };
  };

  const hitTest = (x: number, y: number) => {
    for (let index = definition.entities.length - 1; index >= 0; index -= 1) {
      const entity = definition.entities[index];
      const dx = x - entity.x;
      const dy = y - entity.y;
      if ("radius" in entity) {
        if (Math.hypot(dx, dy) <= entity.radius) return entity.id;
      } else {
        const angle = (-entity.angle * Math.PI) / 180;
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
        if (
          Math.abs(localX) <= entity.width / 2 &&
          Math.abs(localY) <= entity.height / 2
        ) {
          return entity.id;
        }
      }
    }
    const person = definition.character;
    if (
      Math.abs(x - person.x) <= 60 * person.scale &&
      y >= person.y - 95 * person.scale &&
      y <= person.y + 125 * person.scale
    ) {
      return "ragdoll";
    }
    return null;
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = toWorld(event);
    let id = hitTest(point.x, point.y);
    const selected = definition.entities.find(
      (entity) => entity.id === selectedId,
    );
    if (selected) {
      const size = targetSize(selected);
      if (
        Math.abs(point.x - (selected.x + size.width / 2)) <= point.tolerance &&
        Math.abs(point.y - (selected.y + size.height / 2)) <= point.tolerance
      ) {
        id = selected.id;
        gesture.current = {
          id,
          mode: "resize",
          offsetX: 0,
          offsetY: 0,
        };
      }
    }
    onSelect(id);
    if (!id) return;
    if (!gesture.current) {
      const target =
        id === "ragdoll"
          ? definition.character
          : definition.entities.find((entity) => entity.id === id);
      if (!target) return;
      gesture.current = {
        id,
        mode: "move",
        offsetX: point.x - target.x,
        offsetY: point.y - target.y,
      };
    }
    onGestureStart();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!gesture.current) return;
    const point = toWorld(event);
    const grid = snap ? 10 : 1;
    const round = (value: number) => Math.round(value / grid) * grid;
    const active = gesture.current;
    if (active.mode === "move") {
      const x = round(point.x - active.offsetX);
      const y = round(point.y - active.offsetY);
      if (active.id === "ragdoll") {
        onCharacterPatch({ x, y }, false);
      } else {
        onEntityPatch(active.id, { x, y }, false);
      }
    } else {
      const entity = definition.entities.find(
        (item) => item.id === active.id,
      );
      if (!entity) return;
      if ("radius" in entity) {
        onEntityPatch(
          entity.id,
          { radius: Math.max(10, round(Math.hypot(point.x - entity.x, point.y - entity.y))) } as EntityPatch,
          false,
        );
      } else {
        onEntityPatch(
          entity.id,
          {
            width: Math.max(20, round(Math.abs(point.x - entity.x) * 2)),
            height: Math.max(12, round(Math.abs(point.y - entity.y) * 2)),
          } as EntityPatch,
          false,
        );
      }
    }
  };

  const pointerUp = () => {
    gesture.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      className="editor-canvas"
      aria-label="Spielfeld-Editor. Objekte können ausgewählt und verschoben werden."
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    />
  );
}

function GamePlayer({ definition }: { definition: GameDefinition }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<GameController | null>(null);
  const [muted, setMuted] = useState(false);
  const [state, setState] = useState<GameState>({
    score: 0,
    elapsed: 0,
    remaining:
      definition.rules.timeLimit > 0 ? definition.rules.timeLimit : null,
    phase: "paused",
    completedObjectives: [],
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = createGame(canvas, definition);
    controllerRef.current = controller;
    const unsubscribe = controller.on(setState);
    controller.start();
    return () => {
      unsubscribe();
      controller.destroy();
      controllerRef.current = null;
    };
  }, [definition]);

  const togglePause = () => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (state.phase === "running") controller.pause();
    else controller.start();
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    controllerRef.current?.setMuted(next);
  };

  return (
    <div className="player-wrap">
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="Interaktive Ragdoll-Spielfläche"
      />
      <div className="player-hud" aria-live="polite">
        {definition.rules.scoreEnabled && (
          <span>{state.score.toLocaleString("de-DE")} Punkte</span>
        )}
        <span>
          {state.remaining === null
            ? "Freies Spiel"
            : `${Math.ceil(state.remaining)} s`}
        </span>
      </div>
      <div className="player-actions">
        <button type="button" onClick={togglePause}>
          {state.phase === "running" ? "⏸ Pause" : "▶ Weiter"}
        </button>
        <button type="button" onClick={() => controllerRef.current?.reset()}>
          ↻ Neu
        </button>
        <button type="button" onClick={toggleMute}>
          {muted ? "🔇 Stumm" : "🔊 Ton"}
        </button>
      </div>
      {definition.rules.objectives.length > 0 && (
        <div className="objective-card">
          <strong>Ziele</strong>
          {definition.rules.objectives.map((objective) => (
            <span
              key={objective.id}
              className={
                state.completedObjectives.includes(objective.id)
                  ? "objective-done"
                  : ""
              }
            >
              {state.completedObjectives.includes(objective.id) ? "✓" : "○"}{" "}
              {objective.label}
            </span>
          ))}
        </div>
      )}
      {(state.phase === "won" || state.phase === "lost") && (
        <div className="result-card" role="status">
          <div>
            <span>{state.phase === "won" ? "✦" : "⌛"}</span>
            <strong>
              {state.phase === "won" ? "Geschafft!" : "Zeit vorbei"}
            </strong>
            <p>
              {state.phase === "won"
                ? "Das war herrlich wackelig."
                : "Einmal schütteln, dann noch mal."}
            </p>
            <button
              type="button"
              onClick={() => controllerRef.current?.reset()}
            >
              Noch einmal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <span className="color-control">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <code>{value.toUpperCase()}</code>
      </span>
    </label>
  );
}

export default function Wackelwerk() {
  const [project, setProject] = useState<GameDefinition>(() =>
    createSandboxTemplate(),
  );
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>("ragdoll");
  const [mode, setMode] = useState<ViewMode>("edit");
  const [playDefinition, setPlayDefinition] = useState<GameDefinition>(() =>
    createSandboxTemplate(),
  );
  const [snap, setSnap] = useState(true);
  const [toast, setToast] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const past = useRef<GameDefinition[]>([]);
  const future = useRef<GameDefinition[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let restored: GameDefinition | null = null;
    try {
      const saved = window.localStorage.getItem("wackelwerk:project:v1");
      if (saved) {
        const result = validateGameDefinition(JSON.parse(saved));
        if (result.ok && result.value) restored = result.value;
      }
    } catch {
      // A damaged local save should never block the editor.
    }
    const frame = window.requestAnimationFrame(() => {
      if (restored) setProject(restored);
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(
      "wackelwerk:project:v1",
      JSON.stringify(project),
    );
  }, [project, ready]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const commit = useCallback(
    (next: GameDefinition) => {
      past.current.push(cloneGame(project));
      if (past.current.length > 80) past.current.shift();
      future.current = [];
      setCanUndo(true);
      setCanRedo(false);
      setProject(next);
    },
    [project],
  );

  const beginGesture = useCallback(() => {
    past.current.push(cloneGame(project));
    if (past.current.length > 80) past.current.shift();
    future.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [project]);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(cloneGame(project));
    setCanUndo(past.current.length > 0);
    setCanRedo(true);
    setProject(previous);
  }, [project]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(cloneGame(project));
    setCanUndo(true);
    setCanRedo(future.current.length > 0);
    setProject(next);
  }, [project]);

  const removeSelected = useCallback(() => {
    if (!selectedId || selectedId === "ragdoll") return;
    const deleted = project.entities.find((entity) => entity.id === selectedId);
    if (!deleted) return;
    const remaining = project.entities.filter(
      (entity) => entity.id !== selectedId,
    );
    const stillHasCollectibles = remaining.some(
      (entity) => entity.type === "collectible",
    );
    commit({
      ...project,
      entities: remaining,
      rules: {
        ...project.rules,
        objectives: project.rules.objectives.filter(
          (objective) =>
            !("targetId" in objective && objective.targetId === selectedId) &&
            !(
              deleted.type === "collectible" &&
              !stillHasCollectibles &&
              objective.type === "collect"
            ),
        ),
      },
    });
    setSelectedId(null);
  }, [commit, project, selectedId]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (mode !== "edit" || isTypingTarget(event.target)) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "y"
      ) {
        event.preventDefault();
        redo();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [mode, redo, removeSelected, undo]);

  const updateEntity = (
    id: string,
    patch: EntityPatch,
    checkpoint = true,
  ) => {
    const next = {
      ...project,
      entities: project.entities.map((entity) =>
        entity.id === id
          ? ({ ...entity, ...patch } as EntityDefinition)
          : entity,
      ),
    };
    if (checkpoint) commit(next);
    else setProject(next);
  };

  const updateCharacter = (
    patch: Partial<GameDefinition["character"]>,
    checkpoint = true,
  ) => {
    const next = {
      ...project,
      character: { ...project.character, ...patch },
    };
    if (checkpoint) commit(next);
    else setProject(next);
  };

  const addEntity = (type: EntityType) => {
    const entity = defaultsFor(type, project.entities.length);
    commit({ ...project, entities: [...project.entities, entity] });
    setSelectedId(entity.id);
    setToast(`${typeLabels[type]} hinzugefügt`);
  };

  const duplicateSelected = () => {
    if (!selectedId || selectedId === "ragdoll") return;
    const entity = project.entities.find((item) => item.id === selectedId);
    if (!entity) return;
    const copy = {
      ...cloneGame({
        ...project,
        entities: [entity],
      }).entities[0],
      id: createId(entity.type),
      x: entity.x + 24,
      y: entity.y + 24,
      label: `${entity.label} Kopie`,
    } as EntityDefinition;
    commit({ ...project, entities: [...project.entities, copy] });
    setSelectedId(copy.id);
  };

  const changeTemplate = (value: string) => {
    const maker = templates[value as keyof typeof templates];
    if (!maker) return;
    commit(maker());
    setSelectedId("ragdoll");
    setMode("edit");
    setToast("Vorlage geladen");
  };

  const enterPlay = () => {
    setPlayDefinition(cloneGame(project));
    setMode("play");
  };

  const exportJson = () => {
    const filename = `${project.meta.title
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/gi, "-")
      .replace(/^-|-$/g, "") || "wackelwerk"}.wackel.json`;
    downloadText(
      filename,
      JSON.stringify(project, null, 2),
      "application/json;charset=utf-8",
    );
    setToast("JSON gespeichert");
  };

  const exportHtml = () => {
    const filename = `${project.meta.title
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/gi, "-")
      .replace(/^-|-$/g, "") || "wackelwerk"}.html`;
    downloadText(
      filename,
      createStandaloneHtml(project),
      "text/html;charset=utf-8",
    );
    setToast("Spiel als HTML gespeichert");
  };

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const input = JSON.parse(await file.text());
      const result = validateGameDefinition(input);
      if (!result.ok || !result.value) {
        setToast(result.error ?? "Die Datei ist ungültig.");
        return;
      }
      commit(result.value);
      setSelectedId("ragdoll");
      setMode("edit");
      setToast("Projekt erfolgreich geöffnet");
    } catch {
      setToast("Die Datei ist kein lesbares Wackelwerk-Projekt.");
    }
  };

  const selectedEntity = useMemo(
    () => project.entities.find((entity) => entity.id === selectedId) ?? null,
    [project.entities, selectedId],
  );

  const hitObjective =
    selectedEntity?.type === "bumper"
      ? project.rules.objectives.find(
          (objective) =>
            objective.type === "hit" &&
            objective.targetId === selectedEntity.id,
        )
      : undefined;
  const reachObjective =
    selectedEntity?.type === "goal"
      ? project.rules.objectives.find(
          (objective) =>
            objective.type === "reach" &&
            objective.targetId === selectedEntity.id,
        )
      : undefined;
  const collectObjective = project.rules.objectives.find(
    (objective) => objective.type === "collect",
  );

  const toggleHitObjective = (enabled: boolean) => {
    if (!selectedEntity || selectedEntity.type !== "bumper") return;
    const objectives = project.rules.objectives.filter(
      (objective) =>
        !(
          objective.type === "hit" &&
          objective.targetId === selectedEntity.id
        ),
    );
    if (enabled) {
      objectives.push({
        id: createId("ziel"),
        type: "hit",
        targetId: selectedEntity.id,
        count: 3,
        label: `${selectedEntity.label} dreimal treffen`,
      });
    }
    commit({
      ...project,
      rules: { ...project.rules, objectives },
    });
  };

  const toggleReachObjective = (enabled: boolean) => {
    if (!selectedEntity || selectedEntity.type !== "goal") return;
    const objectives = project.rules.objectives.filter(
      (objective) =>
        !(
          objective.type === "reach" &&
          objective.targetId === selectedEntity.id
        ),
    );
    if (enabled) {
      objectives.push({
        id: createId("ziel"),
        type: "reach",
        targetId: selectedEntity.id,
        label: `${selectedEntity.label} erreichen`,
      });
    }
    commit({
      ...project,
      rules: { ...project.rules, objectives },
    });
  };

  const toggleCollectObjective = (enabled: boolean) => {
    const objectives: ObjectiveDefinition[] =
      project.rules.objectives.filter(
        (objective) => objective.type !== "collect",
      );
    if (enabled) {
      objectives.push({
        id: createId("ziel"),
        type: "collect",
        label: "Alle Stoffknöpfe einsammeln",
      });
    }
    commit({
      ...project,
      rules: { ...project.rules, objectives },
    });
  };

  const setViewportPreset = (preset: string) => {
    const dimensions: Record<string, { width: number; height: number }> = {
      wide: { width: 960, height: 540 },
      classic: { width: 800, height: 600 },
      portrait: { width: 540, height: 720 },
    };
    if (!dimensions[preset]) return;
    commit({
      ...project,
      viewport: { ...project.viewport, ...dimensions[preset] },
    });
  };

  return (
    <main className="workbench">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <span>
            <strong>Wackelwerk</strong>
            <small>Ragdoll-Spielebaukasten</small>
          </span>
        </div>
        <label className="template-picker">
          <span>Vorlage</span>
          <select
            defaultValue="sandbox"
            onChange={(event) => changeTemplate(event.target.value)}
          >
            <option value="sandbox">Kugel-Kuddelmuddel</option>
            <option value="collect">Knopf-Slalom</option>
            <option value="landing">Sofalandung</option>
          </select>
        </label>
        <div className="mode-switch" aria-label="Arbeitsmodus">
          <button
            type="button"
            className={mode === "edit" ? "active" : ""}
            onClick={() => setMode("edit")}
          >
            ✎ Bauen
          </button>
          <button
            type="button"
            className={mode === "play" ? "active" : ""}
            onClick={enterPlay}
          >
            ▶ Spielen
          </button>
        </div>
        <div className="top-actions">
          <button
            type="button"
            title="Rückgängig"
            aria-label="Rückgängig"
            onClick={undo}
            disabled={!canUndo}
          >
            ↶
          </button>
          <button
            type="button"
            title="Wiederholen"
            aria-label="Wiederholen"
            onClick={redo}
            disabled={!canRedo}
          >
            ↷
          </button>
          <button
            type="button"
            className="new-button"
            onClick={() => {
              commit(createBlankGame());
              setSelectedId("ragdoll");
              setMode("edit");
            }}
          >
            + Neu
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
          >
            Öffnen
          </button>
          <button type="button" onClick={exportJson}>
            JSON
          </button>
          <button type="button" className="export-button" onClick={exportHtml}>
            HTML exportieren
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".json,.wackel.json,application/json"
            onChange={importJson}
          />
        </div>
      </header>

      <div className="editor-layout">
        <aside className="palette-panel" aria-label="Objektpalette">
          <div className="panel-heading">
            <span className="eyebrow">Bauteile</span>
            <strong>Was soll hinein?</strong>
          </div>
          <button
            type="button"
            className={`palette-item character-item ${
              selectedId === "ragdoll" ? "selected" : ""
            }`}
            onClick={() => setSelectedId("ragdoll")}
          >
            <span className="palette-icon doll-icon" aria-hidden="true">
              ☺
            </span>
            <span>
              <strong>Stoffpuppe</strong>
              <small>Bereits im Spiel</small>
            </span>
          </button>
          {palette.map((item) => (
            <button
              key={item.type}
              type="button"
              className="palette-item"
              onClick={() => addEntity(item.type)}
            >
              <span className={`palette-icon icon-${item.type}`}>
                {item.icon}
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
              <b aria-hidden="true">+</b>
            </button>
          ))}
          <div className="palette-note">
            <span>↗</span>
            <p>
              Im <strong>Spielmodus</strong> kannst du jedes Körperteil greifen
              und werfen.
            </p>
          </div>
        </aside>

        <section className="stage-panel">
          <div className="stage-toolbar">
            <div>
              <span className="status-dot" />
              <strong>{project.meta.title}</strong>
              <small>
                {project.viewport.width} × {project.viewport.height}
              </small>
            </div>
            {mode === "edit" ? (
              <div className="stage-tools">
                <label className="snap-control">
                  <input
                    type="checkbox"
                    checked={snap}
                    onChange={(event) => setSnap(event.target.checked)}
                  />
                  Raster 10
                </label>
                <button
                  type="button"
                  onClick={duplicateSelected}
                  disabled={!selectedEntity}
                >
                  ⧉ Duplizieren
                </button>
                <button
                  type="button"
                  className="danger-link"
                  onClick={removeSelected}
                  disabled={!selectedEntity}
                >
                  Löschen
                </button>
              </div>
            ) : (
              <span className="play-hint">Körperteil greifen · ziehen · loslassen</span>
            )}
          </div>
          <div className="canvas-shell">
            {mode === "edit" ? (
              <EditorCanvas
                definition={project}
                selectedId={selectedId}
                snap={snap}
                onSelect={setSelectedId}
                onGestureStart={beginGesture}
                onEntityPatch={updateEntity}
                onCharacterPatch={updateCharacter}
              />
            ) : (
              <GamePlayer definition={playDefinition} />
            )}
          </div>
          <footer className="stage-footer">
            <span>
              {mode === "edit"
                ? "Auswählen und ziehen · Griff unten rechts ändert die Größe"
                : "Die Physik läuft mit festen 60 Schritten pro Sekunde"}
            </span>
            <span className="autosave-status">✓ Lokal gespeichert</span>
          </footer>
        </section>

        <aside className="inspector-panel" aria-label="Eigenschaften">
          <div className="panel-heading inspector-heading">
            <span>
              <span className="eyebrow">Eigenschaften</span>
              <strong>
                {selectedId === "ragdoll"
                  ? "Stoffpuppe"
                  : selectedEntity?.label ?? "Spiel"}
              </strong>
            </span>
            {selectedEntity && (
              <span className="type-chip">{typeLabels[selectedEntity.type]}</span>
            )}
          </div>

          <div className="inspector-scroll">
            {!selectedId && (
              <div className="empty-inspector">
                <span>↖</span>
                <strong>Wähle ein Element</strong>
                <p>Klicke auf die Stoffpuppe oder ein Objekt im Spielfeld.</p>
              </div>
            )}

            {selectedId === "ragdoll" && (
              <>
                <section className="property-section">
                  <h3>Position & Größe</h3>
                  <div className="field-grid">
                    <NumberField
                      label="X"
                      value={project.character.x}
                      onChange={(x) => updateCharacter({ x })}
                    />
                    <NumberField
                      label="Y"
                      value={project.character.y}
                      onChange={(y) => updateCharacter({ y })}
                    />
                  </div>
                  <label className="range-field">
                    <span>
                      Größe <b>{project.character.scale.toFixed(2)}×</b>
                    </span>
                    <input
                      type="range"
                      min="0.55"
                      max="1.8"
                      step="0.05"
                      value={project.character.scale}
                      onChange={(event) =>
                        updateCharacter({ scale: Number(event.target.value) })
                      }
                    />
                  </label>
                </section>
                <section className="property-section">
                  <h3>Vollständig angezogen</h3>
                  <ColorField
                    label="Pullover"
                    value={project.character.sweater}
                    onChange={(sweater) => updateCharacter({ sweater })}
                  />
                  <ColorField
                    label="Hose"
                    value={project.character.trousers}
                    onChange={(trousers) => updateCharacter({ trousers })}
                  />
                  <ColorField
                    label="Schuhe"
                    value={project.character.shoes}
                    onChange={(shoes) => updateCharacter({ shoes })}
                  />
                  <ColorField
                    label="Stoff"
                    value={project.character.fabric}
                    onChange={(fabric) => updateCharacter({ fabric })}
                  />
                  <p className="safe-note">
                    <span>✓</span> Freundlich, neutral und ohne
                    Verletzungsdarstellung.
                  </p>
                </section>
              </>
            )}

            {selectedEntity && (
              <>
                <section className="property-section">
                  <h3>Element</h3>
                  <label className="field field-wide">
                    <span>Name</span>
                    <input
                      value={selectedEntity.label}
                      onChange={(event) =>
                        updateEntity(selectedEntity.id, {
                          label: event.target.value,
                        })
                      }
                    />
                  </label>
                  <div className="field-grid">
                    <NumberField
                      label="X"
                      value={selectedEntity.x}
                      onChange={(x) => updateEntity(selectedEntity.id, { x })}
                    />
                    <NumberField
                      label="Y"
                      value={selectedEntity.y}
                      onChange={(y) => updateEntity(selectedEntity.id, { y })}
                    />
                  </div>
                  <label className="range-field">
                    <span>
                      Drehung <b>{selectedEntity.angle}°</b>
                    </span>
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      step="1"
                      value={selectedEntity.angle}
                      onChange={(event) =>
                        updateEntity(selectedEntity.id, {
                          angle: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  {"radius" in selectedEntity ? (
                    <NumberField
                      label="Radius"
                      value={selectedEntity.radius}
                      min={10}
                      onChange={(radius) =>
                        updateEntity(selectedEntity.id, {
                          radius,
                        } as EntityPatch)
                      }
                    />
                  ) : (
                    <div className="field-grid">
                      <NumberField
                        label="Breite"
                        value={selectedEntity.width}
                        min={20}
                        onChange={(width) =>
                          updateEntity(selectedEntity.id, {
                            width,
                          } as EntityPatch)
                        }
                      />
                      <NumberField
                        label="Höhe"
                        value={selectedEntity.height}
                        min={12}
                        onChange={(height) =>
                          updateEntity(selectedEntity.id, {
                            height,
                          } as EntityPatch)
                        }
                      />
                    </div>
                  )}
                  <ColorField
                    label="Farbe"
                    value={selectedEntity.color}
                    onChange={(color) =>
                      updateEntity(selectedEntity.id, { color })
                    }
                  />
                </section>

                {selectedEntity.type === "bumper" && (
                  <section className="property-section">
                    <h3>Stoß & Ziel</h3>
                    <label className="range-field">
                      <span>
                        Sprungkraft{" "}
                        <b>
                          {(selectedEntity as BumperEntity).bounce.toFixed(2)}
                        </b>
                      </span>
                      <input
                        type="range"
                        min="0.3"
                        max="1.5"
                        step="0.02"
                        value={(selectedEntity as BumperEntity).bounce}
                        onChange={(event) =>
                          updateEntity(selectedEntity.id, {
                            bounce: Number(event.target.value),
                          } as EntityPatch)
                        }
                      />
                    </label>
                    <label className="toggle-row">
                      <span>
                        <strong>Als Trefferziel</strong>
                        <small>Gewinnt nach mehreren Treffern</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(hitObjective)}
                        onChange={(event) =>
                          toggleHitObjective(event.target.checked)
                        }
                      />
                    </label>
                    {hitObjective?.type === "hit" && (
                      <NumberField
                        label="Benötigte Treffer"
                        value={hitObjective.count}
                        min={1}
                        max={99}
                        onChange={(count) =>
                          commit({
                            ...project,
                            rules: {
                              ...project.rules,
                              objectives: project.rules.objectives.map(
                                (objective) =>
                                  objective.id === hitObjective.id &&
                                  objective.type === "hit"
                                    ? {
                                        ...objective,
                                        count,
                                        label: `${selectedEntity.label} ${count}× treffen`,
                                      }
                                    : objective,
                              ),
                            },
                          })
                        }
                      />
                    )}
                  </section>
                )}

                {selectedEntity.type === "spring" && (
                  <section className="property-section">
                    <h3>Sprungkraft</h3>
                    <label className="range-field">
                      <span>
                        Stärke{" "}
                        <b>
                          {(
                            (selectedEntity as SpringEntity).impulse * 1000
                          ).toFixed(0)}
                        </b>
                      </span>
                      <input
                        type="range"
                        min="0.012"
                        max="0.07"
                        step="0.002"
                        value={(selectedEntity as SpringEntity).impulse}
                        onChange={(event) =>
                          updateEntity(selectedEntity.id, {
                            impulse: Number(event.target.value),
                          } as EntityPatch)
                        }
                      />
                    </label>
                  </section>
                )}

                {selectedEntity.type === "force" && (
                  <section className="property-section">
                    <h3>Windrichtung</h3>
                    <div className="field-grid">
                      <NumberField
                        label="Kraft X"
                        value={(selectedEntity as ForceEntity).forceX}
                        step={0.00005}
                        onChange={(forceX) =>
                          updateEntity(selectedEntity.id, {
                            forceX,
                          } as EntityPatch)
                        }
                      />
                      <NumberField
                        label="Kraft Y"
                        value={(selectedEntity as ForceEntity).forceY}
                        step={0.00005}
                        onChange={(forceY) =>
                          updateEntity(selectedEntity.id, {
                            forceY,
                          } as EntityPatch)
                        }
                      />
                    </div>
                  </section>
                )}

                {selectedEntity.type === "goal" && (
                  <section className="property-section">
                    <h3>Spielziel</h3>
                    <label className="toggle-row">
                      <span>
                        <strong>Landung zählt</strong>
                        <small>Rumpf muss die Zone erreichen</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(reachObjective)}
                        onChange={(event) =>
                          toggleReachObjective(event.target.checked)
                        }
                      />
                    </label>
                  </section>
                )}
              </>
            )}

            <section className="property-section game-settings">
              <h3>Spiel & Projekt</h3>
              <label className="field field-wide">
                <span>Titel</span>
                <input
                  value={project.meta.title}
                  onChange={(event) =>
                    commit({
                      ...project,
                      meta: { ...project.meta, title: event.target.value },
                    })
                  }
                />
              </label>
              <label className="field field-wide">
                <span>Beschreibung</span>
                <textarea
                  rows={3}
                  value={project.meta.description}
                  onChange={(event) =>
                    commit({
                      ...project,
                      meta: {
                        ...project.meta,
                        description: event.target.value,
                      },
                    })
                  }
                />
              </label>
              <label className="field field-wide">
                <span>Format</span>
                <select
                  value={
                    project.viewport.width === 800
                      ? "classic"
                      : project.viewport.width === 540
                        ? "portrait"
                        : "wide"
                  }
                  onChange={(event) => setViewportPreset(event.target.value)}
                >
                  <option value="wide">16:9 · 960 × 540</option>
                  <option value="classic">4:3 · 800 × 600</option>
                  <option value="portrait">Hoch · 540 × 720</option>
                </select>
              </label>
              <ColorField
                label="Hintergrund"
                value={project.viewport.background}
                onChange={(background) =>
                  commit({
                    ...project,
                    viewport: { ...project.viewport, background },
                  })
                }
              />
              <label className="range-field">
                <span>
                  Schwerkraft <b>{project.physics.gravityY.toFixed(1)}</b>
                </span>
                <input
                  type="range"
                  min="-1"
                  max="2"
                  step="0.1"
                  value={project.physics.gravityY}
                  onChange={(event) =>
                    commit({
                      ...project,
                      physics: {
                        ...project.physics,
                        gravityY: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <NumberField
                label="Zeitlimit in Sekunden · 0 = aus"
                value={project.rules.timeLimit}
                min={0}
                max={600}
                onChange={(timeLimit) =>
                  commit({
                    ...project,
                    rules: { ...project.rules, timeLimit },
                  })
                }
              />
              <label className="toggle-row">
                <span>
                  <strong>Alle Knöpfe sammeln</strong>
                  <small>
                    {project.entities.filter(
                      (entity) => entity.type === "collectible",
                    ).length || "Keine"}{" "}
                    im Spielfeld
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(collectObjective)}
                  disabled={
                    !project.entities.some(
                      (entity) => entity.type === "collectible",
                    )
                  }
                  onChange={(event) =>
                    toggleCollectObjective(event.target.checked)
                  }
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>Punkte anzeigen</strong>
                  <small>Treffer und Ziele belohnen</small>
                </span>
                <input
                  type="checkbox"
                  checked={project.rules.scoreEnabled}
                  onChange={(event) =>
                    commit({
                      ...project,
                      rules: {
                        ...project.rules,
                        scoreEnabled: event.target.checked,
                      },
                    })
                  }
                />
              </label>
            </section>
          </div>
        </aside>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
