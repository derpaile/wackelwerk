import assert from "node:assert/strict";
import test from "node:test";
import {
  cloneGame,
  createBlankGame,
  fitViewport,
  safeJsonForHtml,
  templates,
  validateGameDefinition,
} from "../lib/game";
import { buildStandaloneHtml } from "../lib/export-core";

test("all built-in templates satisfy schema version 1", () => {
  for (const makeTemplate of Object.values(templates)) {
    const result = validateGameDefinition(makeTemplate());
    assert.equal(result.ok, true, result.error);
    assert.equal(result.value?.schemaVersion, 1);
  }
});

test("rejects duplicate entity ids and dangling objectives", () => {
  const duplicate = createBlankGame();
  duplicate.entities.push({ ...duplicate.entities[0] });
  assert.equal(validateGameDefinition(duplicate).ok, false);

  const dangling = createBlankGame();
  dangling.rules.objectives.push({
    id: "ziel-1",
    type: "reach",
    targetId: "nicht-vorhanden",
    label: "Unerreichbar",
  });
  assert.equal(validateGameDefinition(dangling).ok, false);
});

test("clones projects without sharing nested state", () => {
  const source = createBlankGame();
  const copy = cloneGame(source);
  copy.meta.title = "Geändert";
  copy.entities[0].x = 12;
  assert.notEqual(source.meta.title, copy.meta.title);
  assert.notEqual(source.entities[0].x, copy.entities[0].x);
});

test("fits logical worlds without distorting them", () => {
  assert.deepEqual(fitViewport(1200, 800, 960, 540), {
    scale: 1.25,
    offsetX: 0,
    offsetY: 62.5,
  });
});

test("escapes embedded JSON so exported scripts cannot be closed", () => {
  const encoded = safeJsonForHtml({ title: "</script><script>alert(1)</script>" });
  assert.doesNotMatch(encoded, /<\/script>/i);
  assert.match(encoded, /\\u003c/);
});

test("assembles one self-contained playable HTML document", () => {
  const game = createBlankGame();
  game.meta.title = "Wackeln & Rollen";
  const html = buildStandaloneHtml(
    game,
    "window.Matter={};",
    "window.WackelwerkStandalone=function(){};",
  );
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /window\.__WACKELWERK_GAME__/);
  assert.match(html, /window\.Matter=\{\}/);
  assert.match(html, /WackelwerkStandalone/);
  assert.match(html, /Wackeln &amp; Rollen/);
  assert.doesNotMatch(html, /https?:\/\/.*\.js/i);
});
