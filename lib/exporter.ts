"use client";

import matterSource from "matter-js/build/matter.min.js?raw";
import standaloneRuntime from "./standalone-runtime.js?raw";
import { type GameDefinition } from "./game";
import { buildStandaloneHtml } from "./export-core";

export function createStandaloneHtml(definition: GameDefinition): string {
  return buildStandaloneHtml(definition, matterSource, standaloneRuntime);
}

export function downloadText(
  filename: string,
  content: string,
  type: string,
) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
