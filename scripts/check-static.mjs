import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";

// Load the actual HTML and compiled script, without writing to the shared database.
for (const file of ["../index.html", "../dist/index.html"]) {
  const bundle = await readFile(new URL("app.js", new URL(file, import.meta.url)), "utf8");
  assert.doesNotMatch(bundle, /supabase|ioa_snapshot|ioa_action|sb_publishable_/i);
  assert.doesNotMatch(bundle, /Hub 3|hub3Count|hub3LastSeq/);
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error.message));
  const dom = await JSDOM.fromFile(fileURLToPath(new URL(file, import.meta.url)), {
    runScripts: "dangerously",
    resources: "usable",
    virtualConsole: console,
    beforeParse(window) {
      // Block all Firestore network traffic: static smoke tests must stay offline.
      window.fetch = async () => { throw new Error("Network disabled in static test"); };
      window.XMLHttpRequest = class { open() { throw new Error("Network disabled in static test"); } };

    },
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Page loading timed out")), 5000);
      dom.window.addEventListener("load", () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(errors, []);
    assert.equal(dom.window.document.querySelector("h1")?.textContent, "Une entrée. Un hub.");
    assert.equal(dom.window.document.querySelectorAll(".card").length, 2);
    assert.deepEqual([...dom.window.document.querySelectorAll(".card h2")].map((node) => node.textContent), ["Hub 1", "Hub 2"]);
    assert.equal(dom.window.document.querySelectorAll(".hub-action .card-bottom .add").length, 2);
    assert.ok(dom.window.document.querySelector(".summary .totals .total strong"));
    const addStyle = dom.window.getComputedStyle(dom.window.document.querySelector(".add"));
    assert.equal(addStyle.borderRadius, "7px");
    assert.equal(addStyle.padding, "9px 10px");
    assert.equal(dom.window.document.title, "IOA Rangueil");
    assert.ok(dom.window.document.querySelector(".hub-action").disabled);
  } finally {
    dom.window.close();
  }
}
console.log("Static pages OK: root and dist HTML load the compiled app and both Rangueil hubs (network blocked).");
