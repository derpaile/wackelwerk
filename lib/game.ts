export type EntityType =
  | "platform"
  | "bumper"
  | "spring"
  | "force"
  | "collectible"
  | "goal";

export interface BaseEntity {
  id: string;
  type: EntityType;
  x: number;
  y: number;
  angle: number;
  color: string;
  label: string;
}

export interface PlatformEntity extends BaseEntity {
  type: "platform";
  width: number;
  height: number;
}

export interface BumperEntity extends BaseEntity {
  type: "bumper";
  radius: number;
  bounce: number;
}

export interface SpringEntity extends BaseEntity {
  type: "spring";
  width: number;
  height: number;
  impulse: number;
}

export interface ForceEntity extends BaseEntity {
  type: "force";
  width: number;
  height: number;
  forceX: number;
  forceY: number;
}

export interface CollectibleEntity extends BaseEntity {
  type: "collectible";
  radius: number;
}

export interface GoalEntity extends BaseEntity {
  type: "goal";
  width: number;
  height: number;
}

export type EntityDefinition =
  | PlatformEntity
  | BumperEntity
  | SpringEntity
  | ForceEntity
  | CollectibleEntity
  | GoalEntity;

export type ObjectiveDefinition =
  | {
      id: string;
      type: "hit";
      targetId: string;
      count: number;
      label: string;
    }
  | {
      id: string;
      type: "collect";
      label: string;
    }
  | {
      id: string;
      type: "reach";
      targetId: string;
      label: string;
    };

export interface GameDefinition {
  schemaVersion: 1;
  meta: {
    title: string;
    description: string;
  };
  viewport: {
    width: number;
    height: number;
    background: string;
  };
  physics: {
    gravityX: number;
    gravityY: number;
  };
  character: {
    x: number;
    y: number;
    scale: number;
    sweater: string;
    trousers: string;
    shoes: string;
    fabric: string;
  };
  entities: EntityDefinition[];
  rules: {
    timeLimit: number;
    scoreEnabled: boolean;
    objectives: ObjectiveDefinition[];
  };
  theme: {
    accent: string;
    secondary: string;
  };
}

export interface ValidationResult {
  ok: boolean;
  value?: GameDefinition;
  error?: string;
}

const entityTypes = new Set<EntityType>([
  "platform",
  "bumper",
  "spring",
  "force",
  "collectible",
  "goal",
]);

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const color = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export function createId(prefix = "objekt"): string {
  const id =
    typeof globalThis.crypto !== "undefined" &&
    "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${id}`;
}

export function cloneGame(game: GameDefinition): GameDefinition {
  return JSON.parse(JSON.stringify(game)) as GameDefinition;
}

export function fitViewport(
  containerWidth: number,
  containerHeight: number,
  worldWidth: number,
  worldHeight: number,
) {
  const scale = Math.min(
    containerWidth / worldWidth,
    containerHeight / worldHeight,
  );
  return {
    scale,
    offsetX: (containerWidth - worldWidth * scale) / 2,
    offsetY: (containerHeight - worldHeight * scale) / 2,
  };
}

export function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function validateGameDefinition(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Die Datei enthält kein gültiges Spiel." };
  }
  const game = input as Partial<GameDefinition>;
  if (game.schemaVersion !== 1) {
    return {
      ok: false,
      error: "Diese Schema-Version wird noch nicht unterstützt.",
    };
  }
  if (
    !game.meta ||
    typeof game.meta.title !== "string" ||
    typeof game.meta.description !== "string"
  ) {
    return { ok: false, error: "Titel oder Beschreibung fehlen." };
  }
  if (
    !game.viewport ||
    !finite(game.viewport.width) ||
    !finite(game.viewport.height) ||
    game.viewport.width < 320 ||
    game.viewport.height < 320 ||
    !color(game.viewport.background)
  ) {
    return { ok: false, error: "Die Spielfeldgröße oder Farbe ist ungültig." };
  }
  if (
    !game.physics ||
    !finite(game.physics.gravityX) ||
    !finite(game.physics.gravityY)
  ) {
    return { ok: false, error: "Die Schwerkraft ist ungültig." };
  }
  if (
    !game.character ||
    !finite(game.character.x) ||
    !finite(game.character.y) ||
    !finite(game.character.scale) ||
    game.character.scale <= 0 ||
    !color(game.character.sweater) ||
    !color(game.character.trousers) ||
    !color(game.character.shoes) ||
    !color(game.character.fabric)
  ) {
    return { ok: false, error: "Die Stoffpuppe ist unvollständig." };
  }
  if (!Array.isArray(game.entities)) {
    return { ok: false, error: "Die Objektliste fehlt." };
  }

  const ids = new Set<string>();
  for (const item of game.entities) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      ids.has(item.id) ||
      !entityTypes.has(item.type) ||
      !finite(item.x) ||
      !finite(item.y) ||
      !finite(item.angle) ||
      !color(item.color) ||
      typeof item.label !== "string"
    ) {
      return {
        ok: false,
        error: "Mindestens ein Objekt ist ungültig oder doppelt vorhanden.",
      };
    }
    ids.add(item.id);
    if (
      ("width" in item &&
        (!finite(item.width) ||
          !finite(item.height) ||
          item.width <= 0 ||
          item.height <= 0)) ||
      ("radius" in item && (!finite(item.radius) || item.radius <= 0))
    ) {
      return { ok: false, error: `Die Größe von „${item.label}“ ist ungültig.` };
    }
  }

  if (
    !game.rules ||
    !finite(game.rules.timeLimit) ||
    game.rules.timeLimit < 0 ||
    typeof game.rules.scoreEnabled !== "boolean" ||
    !Array.isArray(game.rules.objectives)
  ) {
    return { ok: false, error: "Die Spielregeln sind ungültig." };
  }
  const objectiveIds = new Set<string>();
  for (const objective of game.rules.objectives) {
    if (
      !objective ||
      typeof objective.id !== "string" ||
      objectiveIds.has(objective.id) ||
      typeof objective.label !== "string"
    ) {
      return { ok: false, error: "Mindestens ein Ziel ist ungültig." };
    }
    objectiveIds.add(objective.id);
    if (
      objective.type === "hit" &&
      (!ids.has(objective.targetId) ||
        !finite(objective.count) ||
        objective.count < 1)
    ) {
      return { ok: false, error: "Ein Trefferziel verweist ins Leere." };
    }
    if (
      objective.type === "reach" &&
      !ids.has(objective.targetId)
    ) {
      return { ok: false, error: "Eine Zielzone verweist ins Leere." };
    }
    if (!["hit", "collect", "reach"].includes(objective.type)) {
      return { ok: false, error: "Ein unbekannter Zieltyp wurde gefunden." };
    }
  }
  return { ok: true, value: cloneGame(game as GameDefinition) };
}

const baseGame = (
  title: string,
  description: string,
  background = "#f4efe6",
): GameDefinition => ({
  schemaVersion: 1,
  meta: { title, description },
  viewport: { width: 960, height: 540, background },
  physics: { gravityX: 0, gravityY: 1 },
  character: {
    x: 210,
    y: 175,
    scale: 1,
    sweater: "#e76f51",
    trousers: "#355070",
    shoes: "#25283d",
    fabric: "#d6b47c",
  },
  entities: [],
  rules: { timeLimit: 0, scoreEnabled: true, objectives: [] },
  theme: { accent: "#e76f51", secondary: "#2a9d8f" },
});

export function createBlankGame(): GameDefinition {
  const game = baseGame(
    "Mein Wackelwerk",
    "Ein neues kleines Physikspiel.",
    "#f7f1e8",
  );
  game.character.x = 480;
  game.character.y = 190;
  game.entities = [
    {
      id: "boden",
      type: "platform",
      x: 480,
      y: 510,
      width: 820,
      height: 26,
      angle: 0,
      color: "#335c67",
      label: "Weicher Boden",
    },
  ];
  return game;
}

export function createSandboxTemplate(): GameDefinition {
  const game = baseGame(
    "Kugel-Kuddelmuddel",
    "Greifen, werfen und zwischen weichen Stoßfängern herumkullern.",
    "#f6efe5",
  );
  game.entities = [
    {
      id: "boden",
      type: "platform",
      x: 480,
      y: 518,
      width: 900,
      height: 28,
      angle: 0,
      color: "#264653",
      label: "Boden",
    },
    {
      id: "bumper-a",
      type: "bumper",
      x: 420,
      y: 245,
      radius: 58,
      bounce: 1.1,
      angle: 0,
      color: "#2a9d8f",
      label: "Minz-Kugel",
    },
    {
      id: "bumper-b",
      type: "bumper",
      x: 650,
      y: 155,
      radius: 72,
      bounce: 1.12,
      angle: 0,
      color: "#e9c46a",
      label: "Sonnen-Kugel",
    },
    {
      id: "bumper-c",
      type: "bumper",
      x: 730,
      y: 375,
      radius: 86,
      bounce: 1.08,
      angle: 0,
      color: "#f4a261",
      label: "Aprikosen-Kugel",
    },
    {
      id: "spring-a",
      type: "spring",
      x: 300,
      y: 470,
      width: 130,
      height: 24,
      impulse: 0.038,
      angle: -8,
      color: "#e76f51",
      label: "Sprungbrett",
    },
  ];
  return game;
}

export function createCollectTemplate(): GameDefinition {
  const game = baseGame(
    "Knopf-Slalom",
    "Sammle alle Stoffknöpfe zwischen Wind und Sprungflächen.",
    "#eef6f2",
  );
  game.character.x = 120;
  game.character.y = 180;
  game.entities = [
    {
      id: "boden",
      type: "platform",
      x: 480,
      y: 518,
      width: 920,
      height: 30,
      angle: 0,
      color: "#355070",
      label: "Boden",
    },
    {
      id: "rampe",
      type: "platform",
      x: 300,
      y: 380,
      width: 260,
      height: 22,
      angle: -12,
      color: "#6d597a",
      label: "Rampe",
    },
    {
      id: "spring",
      type: "spring",
      x: 520,
      y: 455,
      width: 120,
      height: 22,
      impulse: 0.042,
      angle: 0,
      color: "#e76f51",
      label: "Sprungfläche",
    },
    {
      id: "wind",
      type: "force",
      x: 690,
      y: 300,
      width: 180,
      height: 300,
      forceX: -0.00025,
      forceY: -0.00028,
      angle: 0,
      color: "#8ecae6",
      label: "Aufwind",
    },
    ...[
      [330, 245],
      [540, 300],
      [720, 180],
      [820, 390],
    ].map(
      ([x, y], index): CollectibleEntity => ({
        id: `knopf-${index + 1}`,
        type: "collectible",
        x,
        y,
        radius: 18,
        angle: 0,
        color: index % 2 ? "#e9c46a" : "#e76f51",
        label: `Knopf ${index + 1}`,
      }),
    ),
  ];
  game.rules.objectives = [
    {
      id: "alle-knoepfe",
      type: "collect",
      label: "Alle vier Knöpfe einsammeln",
    },
  ];
  return game;
}

export function createLandingTemplate(): GameDefinition {
  const game = baseGame(
    "Sofalandung",
    "Erreiche die weiche Zielzone, bevor die Zeit abläuft.",
    "#eef3f8",
  );
  game.character.x = 145;
  game.character.y = 125;
  game.entities = [
    {
      id: "boden",
      type: "platform",
      x: 480,
      y: 520,
      width: 920,
      height: 28,
      angle: 0,
      color: "#355070",
      label: "Boden",
    },
    {
      id: "bumper-1",
      type: "bumper",
      x: 360,
      y: 250,
      radius: 55,
      bounce: 1.1,
      angle: 0,
      color: "#2a9d8f",
      label: "Stoßfänger",
    },
    {
      id: "bumper-2",
      type: "bumper",
      x: 590,
      y: 170,
      radius: 70,
      bounce: 1.12,
      angle: 0,
      color: "#e9c46a",
      label: "Stoßfänger",
    },
    {
      id: "ziel",
      type: "goal",
      x: 770,
      y: 455,
      width: 230,
      height: 82,
      angle: 0,
      color: "#90be6d",
      label: "Sofazone",
    },
  ];
  game.rules.timeLimit = 25;
  game.rules.objectives = [
    {
      id: "weich-landen",
      type: "reach",
      targetId: "ziel",
      label: "In der Sofazone landen",
    },
  ];
  return game;
}

export const templates = {
  sandbox: createSandboxTemplate,
  collect: createCollectTemplate,
  landing: createLandingTemplate,
};
