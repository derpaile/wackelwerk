import { type GameDefinition, safeJsonForHtml } from "./game";

const safeScript = (source: string) =>
  source.replace(/<\/script/gi, "<\\/script");

const htmlEscape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function buildStandaloneHtml(
  definition: GameDefinition,
  matterSource: string,
  standaloneRuntime: string,
): string {
  const game = safeJsonForHtml(definition);
  const title = htmlEscape(definition.meta.title);
  const description = htmlEscape(definition.meta.description);
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="description" content="${description}">
  <title>${title} · Wackelwerk</title>
  <style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#1f2733;font-family:ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif}
    body{display:grid;grid-template-rows:auto 1fr;color:#fff}.bar{display:flex;align-items:center;gap:10px;padding:10px max(12px,env(safe-area-inset-right)) 10px max(12px,env(safe-area-inset-left));background:#202936;border-bottom:1px solid #ffffff1f}
    .title{min-width:0;flex:1}.title strong,.title span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.title span{font-size:12px;color:#b9c4d2;margin-top:2px}
    .pill{font-size:12px;font-weight:800;padding:6px 10px;border-radius:999px;background:#ffffff12;color:#e9c46a}.bar button{appearance:none;border:1px solid #ffffff26;background:#fff;color:#26303b;border-radius:10px;padding:8px 11px;font:inherit;font-weight:800;cursor:pointer}.bar button:hover{background:#f4ede4}
    .stage{position:relative;min-height:0}.stage canvas{display:block;width:100%;height:100%;touch-action:none}.status{position:absolute;top:12px;left:12px;display:flex;gap:8px;pointer-events:none}.status span{background:#202936dc;padding:8px 11px;border-radius:10px;font-size:13px;font-weight:800;box-shadow:0 6px 20px #1d26302b}
    .message{position:absolute;inset:0;display:none;place-items:center;pointer-events:none}.message.show{display:grid}.message div{background:#202936ed;border:1px solid #ffffff2b;border-radius:18px;padding:20px 26px;text-align:center;box-shadow:0 22px 70px #10182066}.message strong{display:block;font-size:24px;margin-bottom:6px}.message span{color:#c7d0db}
    @media(max-width:620px){.bar{gap:6px}.bar button{font-size:0;padding:9px}.bar button::first-letter{font-size:16px}.title span{display:none}.pill{display:none}.status{top:8px;left:8px}.status span{padding:6px 8px}}
  </style>
</head>
<body>
  <header class="bar">
    <div class="title"><strong>${title}</strong><span>${description}</span></div>
    <span class="pill">Wackelwerk</span>
    <button id="pause" aria-label="Pause oder weiterspielen">⏸ Pause</button>
    <button id="reset" aria-label="Spiel neu starten">↻ Neu</button>
    <button id="mute" aria-label="Ton umschalten">🔊 Ton</button>
  </header>
  <main class="stage">
    <canvas id="game" aria-label="Interaktive Ragdoll-Spielfläche"></canvas>
    <div class="status"><span id="score">0 Punkte</span><span id="time">Freies Spiel</span></div>
    <div class="message" id="message"><div><strong id="message-title"></strong><span id="message-copy"></span></div></div>
  </main>
  <script>${safeScript(matterSource)}</script>
  <script>${safeScript(standaloneRuntime)}</script>
  <script>
    window.__WACKELWERK_GAME__=${game};
    window.WackelwerkStandalone(document.getElementById("game"),window.__WACKELWERK_GAME__);
  </script>
</body>
</html>`;
}
