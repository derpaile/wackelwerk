import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", {
      headers: {
        accept: "text/html",
        host: "localhost",
        "x-forwarded-proto": "http",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the complete Wackelwerk editor shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Wackelwerk/);
  assert.match(html, /Ragdoll-Spielebaukasten/);
  assert.match(html, /Stoffpuppe/);
  assert.match(html, /HTML exportieren/);
  assert.match(html, /Kugel-Kuddelmuddel/);
  assert.match(html, /Vollständig angezogen/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  assert.doesNotMatch(html, /Boneless Girl/i);
});

test("ships site-specific metadata", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /Wackelwerk – Ragdoll-Spiele visuell bauen/);
  assert.match(html, /og\.png/);
  assert.match(html, /lang="de"/);
});
