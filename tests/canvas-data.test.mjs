import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildRecords,
  classifyPhase,
  imageRefs,
  slugForImage,
  stripEmbeds,
} from "../web-data-utils.mjs";

const raw = JSON.parse(fs.readFileSync(path.join("output", "canvas-raw.json"), "utf8"));

test("extracts every embedded image group from the canvas", () => {
  const records = buildRecords(raw, new Map());

  assert.equal(records.length, 72);
  assert.equal(records.reduce((sum, record) => sum + record.images.length, 0), 138);
  assert.equal(records.filter((record) => record.prompt.trim()).length, 71);
  assert.equal(records.filter((record) => record.uncertain).length, 1);
});

test("parses embeds, prompts, phases, and stable local image names", () => {
  const text = "![[Pasted image 20260519175009.png]]![[foo.jpg]]\n保持同一病房、同一病床。";

  assert.deepEqual(imageRefs(text), ["Pasted image 20260519175009.png", "foo.jpg"]);
  assert.equal(stripEmbeds(text), "保持同一病房、同一病床。");
  assert.equal(classifyPhase({ y: 7520 }, stripEmbeds(text), imageRefs(text)), "医院");
  assert.equal(slugForImage("Pasted image 20260519175009.png", 3), "003-pasted-image-20260519175009.png");
});
