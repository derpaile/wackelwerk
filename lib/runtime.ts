"use client";

import Matter from "matter-js";
import {
  type EntityDefinition,
  type GameDefinition,
  fitViewport,
} from "./game";

export type GamePhase = "running" | "paused" | "won" | "lost";

export interface GameState {
  score: number;
  elapsed: number;
  remaining: number | null;
  phase: GamePhase;
  completedObjectives: string[];
}

type Listener = (state: GameState) => void;

export interface GameController {
  start(): void;
  pause(): void;
  reset(): void;
  destroy(): void;
  setMuted(muted: boolean): void;
  on(listener: Listener): () => void;
  getState(): GameState;
}

interface ShapeInfo {
  kind: "head" | "torso" | "arm" | "leg";
  width: number;
  height: number;
  side?: "left" | "right";
}

interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export function createGame(
  canvas: HTMLCanvasElement,
  source: GameDefinition,
): GameController {
  const definition = JSON.parse(JSON.stringify(source)) as GameDefinition;
  const {
    Engine,
    Bodies,
    Body,
    Composite,
    Constraint,
    Events,
    Query,
    Vector,
  } = Matter;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas wird von diesem Browser nicht unterstützt.");

  const engine = Engine.create({
    gravity: {
      x: definition.physics.gravityX,
      y: definition.physics.gravityY,
      scale: 0.001,
    },
    constraintIterations: 4,
    positionIterations: 8,
    velocityIterations: 6,
  });
  const listeners = new Set<Listener>();
  const entityBodies = new Map<string, Matter.Body>();
  const ragdollBodies: Matter.Body[] = [];
  const shapes = new Map<number, ShapeInfo>();
  const spawns = new Map<number, { x: number; y: number; angle: number }>();
  const collected = new Set<string>();
  const reached = new Set<string>();
  const hitCounts = new Map<string, number>();
  const confetti: Confetti[] = [];
  const fixedStep = 1000 / 60;
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let score = 0;
  let elapsed = 0;
  let phase: GamePhase = "paused";
  let running = false;
  let muted = false;
  let raf = 0;
  let lastFrame = performance.now();
  let accumulator = 0;
  let activePointer: number | null = null;
  let dragConstraint: Matter.Constraint | null = null;
  let audioContext: AudioContext | null = null;

  const completedObjectives = () =>
    definition.rules.objectives
      .filter((objective) => {
        if (objective.type === "hit") {
          return (hitCounts.get(objective.targetId) ?? 0) >= objective.count;
        }
        if (objective.type === "collect") {
          return (
            definition.entities.filter((entity) => entity.type === "collectible")
              .length === collected.size
          );
        }
        return reached.has(objective.targetId);
      })
      .map((objective) => objective.id);

  const state = (): GameState => ({
    score,
    elapsed,
    remaining:
      definition.rules.timeLimit > 0
        ? Math.max(0, definition.rules.timeLimit - elapsed)
        : null,
    phase,
    completedObjectives: completedObjectives(),
  });

  const emit = () => {
    const next = state();
    listeners.forEach((listener) => listener(next));
  };

  const tone = (frequency: number, duration = 0.09, gain = 0.045) => {
    if (muted || !audioContext) return;
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(90, frequency * 0.62),
      audioContext.currentTime + duration,
    );
    volume.gain.setValueAtTime(gain, audioContext.currentTime);
    volume.gain.exponentialRampToValueAtTime(
      0.001,
      audioContext.currentTime + duration,
    );
    oscillator.connect(volume).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  };

  const unlockAudio = () => {
    if (!audioContext) {
      const AudioCtor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtor) audioContext = new AudioCtor();
    }
    void audioContext?.resume();
  };

  const addConfetti = (x: number, y: number, amount = 18) => {
    if (reduceMotion) return;
    const colors = [
      definition.theme.accent,
      definition.theme.secondary,
      "#e9c46a",
      "#ffffff",
    ];
    for (let index = 0; index < amount; index += 1) {
      confetti.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 5,
        vy: -Math.random() * 5 - 1,
        life: 1,
        color: colors[index % colors.length],
      });
    }
  };

  const makeRagdoll = () => {
    const { x, y, scale } = definition.character;
    const group = Body.nextGroup(true);
    const options = {
      collisionFilter: { group },
      friction: 0.6,
      frictionAir: 0.018,
      restitution: 0.18,
      density: 0.0018,
      chamfer: { radius: 10 * scale },
    };
    const part = (
      label: string,
      px: number,
      py: number,
      width: number,
      height: number,
      kind: ShapeInfo["kind"],
      angle = 0,
      side?: "left" | "right",
    ) => {
      const body =
        kind === "head"
          ? Bodies.circle(px, py, width / 2, {
              ...options,
              label: `ragdoll:${label}`,
            })
          : Bodies.rectangle(px, py, width, height, {
              ...options,
              angle,
              label: `ragdoll:${label}`,
            });
      shapes.set(body.id, { kind, width, height, side });
      spawns.set(body.id, { x: px, y: py, angle });
      ragdollBodies.push(body);
      return body;
    };

    const head = part(
      "head",
      x,
      y - 64 * scale,
      42 * scale,
      42 * scale,
      "head",
    );
    const torso = part(
      "torso",
      x,
      y - 12 * scale,
      46 * scale,
      68 * scale,
      "torso",
    );
    const leftUpperArm = part(
      "left-upper-arm",
      x - 34 * scale,
      y - 18 * scale,
      17 * scale,
      43 * scale,
      "arm",
      0.22,
      "left",
    );
    const leftLowerArm = part(
      "left-lower-arm",
      x - 45 * scale,
      y + 21 * scale,
      15 * scale,
      42 * scale,
      "arm",
      0.12,
      "left",
    );
    const rightUpperArm = part(
      "right-upper-arm",
      x + 34 * scale,
      y - 18 * scale,
      17 * scale,
      43 * scale,
      "arm",
      -0.22,
      "right",
    );
    const rightLowerArm = part(
      "right-lower-arm",
      x + 45 * scale,
      y + 21 * scale,
      15 * scale,
      42 * scale,
      "arm",
      -0.12,
      "right",
    );
    const leftUpperLeg = part(
      "left-upper-leg",
      x - 14 * scale,
      y + 47 * scale,
      21 * scale,
      51 * scale,
      "leg",
      0.05,
      "left",
    );
    const leftLowerLeg = part(
      "left-lower-leg",
      x - 15 * scale,
      y + 94 * scale,
      19 * scale,
      48 * scale,
      "leg",
      0.02,
      "left",
    );
    const rightUpperLeg = part(
      "right-upper-leg",
      x + 14 * scale,
      y + 47 * scale,
      21 * scale,
      51 * scale,
      "leg",
      -0.05,
      "right",
    );
    const rightLowerLeg = part(
      "right-lower-leg",
      x + 15 * scale,
      y + 94 * scale,
      19 * scale,
      48 * scale,
      "leg",
      -0.02,
      "right",
    );
    const joint = (
      bodyA: Matter.Body,
      bodyB: Matter.Body,
      pointA: Matter.Vector,
      pointB: Matter.Vector,
      stiffness = 0.78,
    ) =>
      Constraint.create({
        bodyA,
        bodyB,
        pointA,
        pointB,
        length: 0,
        stiffness,
        damping: 0.12,
        render: { visible: false },
      });
    const s = scale;
    Composite.add(engine.world, [
      ...ragdollBodies,
      joint(torso, head, { x: 0, y: -31 * s }, { x: 0, y: 20 * s }),
      joint(
        torso,
        leftUpperArm,
        { x: -23 * s, y: -23 * s },
        { x: 0, y: -20 * s },
      ),
      joint(
        leftUpperArm,
        leftLowerArm,
        { x: 0, y: 20 * s },
        { x: 0, y: -19 * s },
        0.7,
      ),
      joint(
        torso,
        rightUpperArm,
        { x: 23 * s, y: -23 * s },
        { x: 0, y: -20 * s },
      ),
      joint(
        rightUpperArm,
        rightLowerArm,
        { x: 0, y: 20 * s },
        { x: 0, y: -19 * s },
        0.7,
      ),
      joint(
        torso,
        leftUpperLeg,
        { x: -13 * s, y: 32 * s },
        { x: 0, y: -23 * s },
      ),
      joint(
        leftUpperLeg,
        leftLowerLeg,
        { x: 0, y: 23 * s },
        { x: 0, y: -22 * s },
        0.72,
      ),
      joint(
        torso,
        rightUpperLeg,
        { x: 13 * s, y: 32 * s },
        { x: 0, y: -23 * s },
      ),
      joint(
        rightUpperLeg,
        rightLowerLeg,
        { x: 0, y: 23 * s },
        { x: 0, y: -22 * s },
        0.72,
      ),
    ]);
  };

  const makeEntity = (entity: EntityDefinition) => {
    const angle = (entity.angle * Math.PI) / 180;
    let body: Matter.Body;
    if (entity.type === "bumper") {
      body = Bodies.circle(entity.x, entity.y, entity.radius, {
        isStatic: true,
        restitution: entity.bounce,
        friction: 0.05,
        label: `entity:${entity.id}`,
      });
    } else if (entity.type === "collectible") {
      body = Bodies.circle(entity.x, entity.y, entity.radius, {
        isStatic: true,
        isSensor: true,
        label: `entity:${entity.id}`,
      });
    } else {
      body = Bodies.rectangle(
        entity.x,
        entity.y,
        entity.width,
        entity.height,
        {
          isStatic: true,
          isSensor: entity.type === "force" || entity.type === "goal",
          angle,
          restitution: entity.type === "spring" ? 1 : 0.2,
          friction: 0.55,
          chamfer:
            entity.type === "platform" || entity.type === "spring"
              ? { radius: 8 }
              : undefined,
          label: `entity:${entity.id}`,
        },
      );
    }
    entityBodies.set(entity.id, body);
    Composite.add(engine.world, body);
  };

  const buildWorld = () => {
    const { width, height } = definition.viewport;
    const walls = [
      Bodies.rectangle(width / 2, height + 40, width + 160, 80, {
        isStatic: true,
        label: "boundary",
      }),
      Bodies.rectangle(width / 2, -40, width + 160, 80, {
        isStatic: true,
        label: "boundary",
      }),
      Bodies.rectangle(-40, height / 2, 80, height + 160, {
        isStatic: true,
        label: "boundary",
      }),
      Bodies.rectangle(width + 40, height / 2, 80, height + 160, {
        isStatic: true,
        label: "boundary",
      }),
    ];
    Composite.add(engine.world, walls);
    definition.entities.forEach(makeEntity);
    makeRagdoll();
  };

  const restoreRagdoll = () => {
    ragdollBodies.forEach((body) => {
      const spawn = spawns.get(body.id);
      if (!spawn) return;
      Body.setPosition(body, { x: spawn.x, y: spawn.y });
      Body.setAngle(body, spawn.angle);
      Body.setVelocity(body, { x: 0, y: 0 });
      Body.setAngularVelocity(body, 0);
    });
  };

  const finishIfReady = () => {
    if (
      phase === "running" &&
      definition.rules.objectives.length > 0 &&
      completedObjectives().length === definition.rules.objectives.length
    ) {
      phase = "won";
      running = false;
      score += Math.max(0, Math.round(500 - elapsed * 4));
      addConfetti(
        definition.viewport.width / 2,
        definition.viewport.height / 2,
        80,
      );
      tone(740, 0.3, 0.06);
      emit();
    }
  };

  const entityFromBody = (body: Matter.Body) => {
    if (!body.label.startsWith("entity:")) return null;
    const id = body.label.slice(7);
    return definition.entities.find((entity) => entity.id === id) ?? null;
  };

  const ragdollFromPair = (pair: Matter.Pair) => {
    const aRagdoll = pair.bodyA.label.startsWith("ragdoll:");
    const bRagdoll = pair.bodyB.label.startsWith("ragdoll:");
    if (!aRagdoll && !bRagdoll) return null;
    return {
      ragdoll: aRagdoll ? pair.bodyA : pair.bodyB,
      other: aRagdoll ? pair.bodyB : pair.bodyA,
    };
  };

  const onCollision = (event: Matter.IEventCollision<Matter.Engine>) => {
    event.pairs.forEach((pair) => {
      const match = ragdollFromPair(pair);
      if (!match) return;
      const entity = entityFromBody(match.other);
      if (!entity) return;
      if (entity.type === "bumper") {
        const next = (hitCounts.get(entity.id) ?? 0) + 1;
        hitCounts.set(entity.id, next);
        score += 10;
        tone(190 + Math.min(220, match.ragdoll.speed * 12));
      }
      if (entity.type === "spring") {
        Body.applyForce(match.ragdoll, match.ragdoll.position, {
          x: Math.sin((entity.angle * Math.PI) / 180) * entity.impulse,
          y: -Math.cos((entity.angle * Math.PI) / 180) * entity.impulse,
        });
        score += 15;
        tone(280, 0.14, 0.055);
      }
      if (entity.type === "collectible" && !collected.has(entity.id)) {
        collected.add(entity.id);
        Composite.remove(engine.world, match.other);
        score += 100;
        addConfetti(entity.x, entity.y, 22);
        tone(620, 0.14, 0.05);
      }
      if (
        entity.type === "goal" &&
        match.ragdoll.label === "ragdoll:torso" &&
        !reached.has(entity.id)
      ) {
        reached.add(entity.id);
        score += 250;
        addConfetti(entity.x, entity.y, 34);
        tone(520, 0.2, 0.055);
      }
      emit();
      finishIfReady();
    });
  };

  const beforeUpdate = (event: Matter.IEventTimestamped<Matter.Engine>) => {
    const delta =
      (event as Matter.IEventTimestamped<Matter.Engine> & { delta?: number })
        .delta ?? fixedStep;
    elapsed += delta / 1000;
    definition.entities
      .filter((entity): entity is Extract<EntityDefinition, { type: "force" }> =>
        entity.type === "force",
      )
      .forEach((zone) => {
        ragdollBodies.forEach((body) => {
          if (
            Math.abs(body.position.x - zone.x) <= zone.width / 2 &&
            Math.abs(body.position.y - zone.y) <= zone.height / 2
          ) {
            Body.applyForce(body, body.position, {
              x: zone.forceX,
              y: zone.forceY,
            });
          }
        });
      });

    ragdollBodies.forEach((body) => {
      if (body.speed > 26) {
        Body.setVelocity(body, Vector.mult(body.velocity, 26 / body.speed));
      }
    });
    const torso = ragdollBodies.find((body) => body.label === "ragdoll:torso");
    if (
      torso &&
      (!Number.isFinite(torso.position.x) ||
        !Number.isFinite(torso.position.y) ||
        torso.position.y > definition.viewport.height + 500)
    ) {
      restoreRagdoll();
    }
    if (
      definition.rules.timeLimit > 0 &&
      elapsed >= definition.rules.timeLimit &&
      phase === "running"
    ) {
      phase = "lost";
      running = false;
      tone(120, 0.28, 0.05);
      emit();
    } else if (Math.floor(elapsed * 10) % 5 === 0) {
      emit();
    }
  };

  const drawRoundedRect = (
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) => {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  };

  const drawEntity = (entity: EntityDefinition) => {
    if (entity.type === "collectible" && collected.has(entity.id)) return;
    ctx.save();
    ctx.translate(entity.x, entity.y);
    ctx.rotate((entity.angle * Math.PI) / 180);
    if (entity.type === "platform") {
      ctx.fillStyle = entity.color;
      ctx.shadowColor = "rgba(36, 42, 54, .18)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 6;
      drawRoundedRect(
        -entity.width / 2,
        -entity.height / 2,
        entity.width,
        entity.height,
        Math.min(10, entity.height / 2),
      );
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "rgba(255,255,255,.3)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-entity.width / 2 + 10, -entity.height / 4);
      ctx.lineTo(entity.width / 2 - 10, -entity.height / 4);
      ctx.stroke();
    }
    if (entity.type === "bumper") {
      ctx.fillStyle = entity.color;
      ctx.shadowColor = "rgba(36, 42, 54, .2)";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "rgba(255,255,255,.72)";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 0, entity.radius - 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.28)";
      ctx.beginPath();
      ctx.arc(-entity.radius * 0.28, -entity.radius * 0.32, entity.radius * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (entity.type === "spring") {
      ctx.fillStyle = entity.color;
      drawRoundedRect(
        -entity.width / 2,
        -entity.height / 2,
        entity.width,
        entity.height,
        8,
      );
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = -entity.width / 2 + 12; x < entity.width / 2 - 8; x += 18) {
        ctx.moveTo(x, 5);
        ctx.lineTo(x + 9, -5);
        ctx.lineTo(x + 18, 5);
      }
      ctx.stroke();
    }
    if (entity.type === "force") {
      ctx.fillStyle = `${entity.color}33`;
      ctx.strokeStyle = entity.color;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.fillRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);
      ctx.strokeRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);
      ctx.setLineDash([]);
      ctx.fillStyle = entity.color;
      ctx.font = "700 22px sans-serif";
      ctx.textAlign = "center";
      for (let y = -entity.height / 2 + 30; y < entity.height / 2; y += 48) {
        ctx.fillText("↑", 0, y);
      }
    }
    if (entity.type === "collectible") {
      ctx.fillStyle = entity.color;
      ctx.shadowColor = `${entity.color}99`;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = "rgba(255,255,255,.75)";
      for (const [x, y] of [
        [-5, -5],
        [5, -5],
        [-5, 5],
        [5, 5],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (entity.type === "goal") {
      ctx.fillStyle = `${entity.color}38`;
      ctx.strokeStyle = entity.color;
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 8]);
      drawRoundedRect(
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
      ctx.font = "800 24px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("WEICH LANDEN", 0, 8);
    }
    ctx.restore();
  };

  const drawPart = (body: Matter.Body) => {
    const shape = shapes.get(body.id);
    if (!shape) return;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(61, 48, 39, .18)";
    if (shape.kind === "head") {
      ctx.fillStyle = definition.character.fabric;
      ctx.beginPath();
      ctx.arc(0, 0, shape.width / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#3a3b45";
      ctx.beginPath();
      ctx.arc(-7, -3, 2.2, 0, Math.PI * 2);
      ctx.arc(7, -3, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#665847";
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.arc(0, 2, 8, 0.2, Math.PI - 0.2);
      ctx.stroke();
    } else {
      ctx.fillStyle =
        shape.kind === "leg"
          ? definition.character.trousers
          : definition.character.sweater;
      drawRoundedRect(
        -shape.width / 2,
        -shape.height / 2,
        shape.width,
        shape.height,
        Math.min(shape.width / 2, 10),
      );
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.22)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(0, -shape.height / 2 + 6);
      ctx.lineTo(0, shape.height / 2 - 6);
      ctx.stroke();
      ctx.setLineDash([]);
      if (shape.kind === "leg" && body.label.includes("lower")) {
        ctx.fillStyle = definition.character.shoes;
        ctx.beginPath();
        ctx.ellipse(
          shape.side === "left" ? -4 : 4,
          shape.height / 2 - 1,
          shape.width * 0.72,
          9,
          shape.side === "left" ? -0.18 : 0.18,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.restore();
  };

  const render = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fit = fitViewport(
      rect.width,
      rect.height,
      definition.viewport.width,
      definition.viewport.height,
    );
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
    ctx.fillStyle = "rgba(255,255,255,.34)";
    for (let x = 24; x < definition.viewport.width; x += 48) {
      for (let y = 24; y < definition.viewport.height; y += 48) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    definition.entities.forEach(drawEntity);
    ragdollBodies
      .filter((body) => body.label.includes("leg"))
      .forEach(drawPart);
    ragdollBodies
      .filter((body) => body.label.includes("arm"))
      .forEach(drawPart);
    ragdollBodies
      .filter((body) => body.label === "ragdoll:torso")
      .forEach(drawPart);
    ragdollBodies
      .filter((body) => body.label === "ragdoll:head")
      .forEach(drawPart);
    if (dragConstraint?.bodyB) {
      ctx.strokeStyle = `${definition.theme.accent}aa`;
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 7]);
      ctx.beginPath();
      ctx.moveTo(dragConstraint.pointA.x, dragConstraint.pointA.y);
      ctx.lineTo(
        dragConstraint.bodyB.position.x,
        dragConstraint.bodyB.position.y,
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }
    confetti.forEach((piece) => {
      ctx.fillStyle = piece.color;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.life * 5);
      ctx.fillRect(-4, -2, 8, 4);
      ctx.restore();
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.vy += 0.12;
      piece.life -= 0.014;
    });
    for (let index = confetti.length - 1; index >= 0; index -= 1) {
      if (confetti[index].life <= 0) confetti.splice(index, 1);
    }
  };

  const frame = (now: number) => {
    const delta = Math.min(100, now - lastFrame);
    lastFrame = now;
    if (running) {
      accumulator += delta;
      while (accumulator >= fixedStep) {
        Engine.update(engine, fixedStep);
        accumulator -= fixedStep;
      }
    }
    render();
    raf = window.requestAnimationFrame(frame);
  };

  const worldPoint = (event: PointerEvent) => {
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
    };
  };

  const releaseDrag = () => {
    if (dragConstraint) {
      Composite.remove(engine.world, dragConstraint);
      dragConstraint = null;
    }
    activePointer = null;
  };

  const pointerDown = (event: PointerEvent) => {
    if (activePointer !== null || phase === "won" || phase === "lost") return;
    unlockAudio();
    const point = worldPoint(event);
    const body = Query.point(ragdollBodies, point).at(-1);
    if (!body) return;
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const localPoint = Vector.rotate(
      Vector.sub(point, body.position),
      -body.angle,
    );
    dragConstraint = Constraint.create({
      pointA: point,
      bodyB: body,
      pointB: localPoint,
      length: 0,
      stiffness: 0.23,
      damping: 0.16,
      render: { visible: false },
    });
    Composite.add(engine.world, dragConstraint);
  };

  const pointerMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointer || !dragConstraint) return;
    dragConstraint.pointA = worldPoint(event);
  };
  const pointerUp = (event: PointerEvent) => {
    if (event.pointerId === activePointer) releaseDrag();
  };

  const visibility = () => {
    if (document.hidden && running) {
      running = false;
      phase = "paused";
      emit();
    }
  };

  Events.on(engine, "collisionStart", onCollision);
  Events.on(engine, "beforeUpdate", beforeUpdate);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  document.addEventListener("visibilitychange", visibility);
  buildWorld();
  render();
  raf = window.requestAnimationFrame(frame);

  const controller: GameController = {
    start() {
      if (phase === "won" || phase === "lost") return;
      phase = "running";
      running = true;
      lastFrame = performance.now();
      emit();
    },
    pause() {
      if (phase === "won" || phase === "lost") return;
      phase = "paused";
      running = false;
      emit();
    },
    reset() {
      releaseDrag();
      Composite.clear(engine.world, false, true);
      entityBodies.clear();
      ragdollBodies.splice(0);
      shapes.clear();
      spawns.clear();
      collected.clear();
      reached.clear();
      hitCounts.clear();
      confetti.splice(0);
      score = 0;
      elapsed = 0;
      accumulator = 0;
      phase = "running";
      running = true;
      buildWorld();
      emit();
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      releaseDrag();
      Events.off(engine, "collisionStart", onCollision);
      Events.off(engine, "beforeUpdate", beforeUpdate);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      document.removeEventListener("visibilitychange", visibility);
      Composite.clear(engine.world, false, true);
      void audioContext?.close();
      listeners.clear();
    },
    setMuted(next) {
      muted = next;
    },
    on(listener) {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
    getState: state,
  };
  return controller;
}
