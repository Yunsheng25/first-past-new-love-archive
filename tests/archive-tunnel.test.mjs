import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

import archiveData from "../data/archive.json" with { type: "json" };
import {
  TUNNEL_RADIUS_X,
  TUNNEL_RADIUS_Y,
  TUNNEL_STEP,
  flattenArchiveOccurrences,
  groupCaseImages,
  tunnelPose,
} from "../src/archive-tunnel-data.js";

const flatSignature = (items) => items.map(({ order, caseId, role, src }) => [order, caseId, role, src]);

test("flattens every authored archive image into its immutable tunnel occurrence", () => {
  const items = flattenArchiveOccurrences(archiveData);

  assert.equal(items.length, 138);
  assert.equal(new Set(items.map((item) => item.src)).size, 137);
  assert.deepEqual(items.map((item) => item.order), Array.from({ length: 138 }, (_, index) => index + 1));
  assert.deepEqual(items[0], {
    order: 1,
    caseId: "case-01",
    caseIndex: 0,
    imageIndex: 0,
    title: archiveData.cases[0].title,
    role: archiveData.cases[0].images[0].role,
    src: archiveData.cases[0].images[0].src,
  });
  assert.deepEqual(items.at(-1), {
    order: 138,
    caseId: "case-72",
    caseIndex: 71,
    imageIndex: 0,
    title: archiveData.cases.at(-1).title,
    role: archiveData.cases.at(-1).images[0].role,
    src: archiveData.cases.at(-1).images[0].src,
  });
  assert.equal(
    crypto.createHash("sha256").update(JSON.stringify(flatSignature(items))).digest("hex"),
    "196ef58e605fa5de25c68cbf6e4bf285d924dde18d8d515f93f1032948e14bd8",
  );
});

test("flattening retains duplicate sources at their authored occurrences without retaining source references", () => {
  const source = structuredClone(archiveData);
  const items = flattenArchiveOccurrences(source);
  const duplicateSource = "assets/canvas-images/038-18.png";
  const matches = items.filter((item) => item.src === duplicateSource);

  assert.deepEqual(matches.map(({ order, caseId, role }) => ({ order, caseId, role })), [
    { order: 38, caseId: "case-21", role: "尾帧" },
    { order: 39, caseId: "case-22", role: "首帧" },
  ]);
  assert.ok(Object.isFrozen(items));
  assert.ok(items.every(Object.isFrozen));
  assert.throws(() => { items.push({}); }, TypeError);
  assert.throws(() => { items[0].title = "changed"; }, TypeError);
  const title = items[0].title;
  source.cases[0].title = "source mutation";
  assert.equal(items[0].title, title);
});

test("groups exact case images in their authored order as immutable copies", () => {
  const expected = archiveData.cases.find((item) => item.id === "case-03").images;
  const images = groupCaseImages(archiveData, "case-03");

  assert.deepEqual(images, expected);
  assert.notStrictEqual(images, expected);
  assert.ok(Object.isFrozen(images));
  assert.ok(images.every(Object.isFrozen));
  assert.throws(() => { images.push({}); }, TypeError);
  assert.throws(() => { images[0].src = "changed"; }, TypeError);
  assert.deepEqual(groupCaseImages(archiveData, "not-a-case"), []);
  assert.ok(Object.isFrozen(groupCaseImages(archiveData, "not-a-case")));
});

test("archive group sizes and every two-image role order match the authored source", () => {
  const histogram = archiveData.cases.reduce((counts, item) => {
    counts[item.images.length] = (counts[item.images.length] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(histogram, { 1: 13, 2: 58, 9: 1 });

  for (const item of archiveData.cases.filter((candidate) => candidate.images.length === 2)) {
    const group = groupCaseImages(archiveData, item.id);
    assert.deepEqual(group.map((image) => image.role), item.images.map((image) => image.role), item.id);
    assert.deepEqual(group.map((image) => image.src), item.images.map((image) => image.src), item.id);
  }
});

test("empty and malformed archive input produces immutable empty results", () => {
  for (const data of [null, undefined, {}, { cases: null }, { cases: "not-an-array" }]) {
    const flattened = flattenArchiveOccurrences(data);
    assert.deepEqual(flattened, []);
    assert.ok(Object.isFrozen(flattened));
    const grouped = groupCaseImages(data, "case-01");
    assert.deepEqual(grouped, []);
    assert.ok(Object.isFrozen(grouped));
  }
});

test("maps valid indexes to deterministic, bounded spiral tunnel poses", () => {
  assert.ok(TUNNEL_STEP > 0);
  assert.ok(TUNNEL_RADIUS_X > 0);
  assert.ok(TUNNEL_RADIUS_Y > 0);
  const start = tunnelPose(0);
  const near = tunnelPose(8);
  const far = tunnelPose(137);

  assert.deepEqual(tunnelPose(8), near);
  for (const pose of [start, near, far]) {
    assert.deepEqual(Object.keys(pose), ["x", "y", "z", "rotationZ"]);
    assert.ok(Object.values(pose).every(Number.isFinite));
    assert.ok(Math.abs(pose.x) <= TUNNEL_RADIUS_X);
    assert.ok(Math.abs(pose.y) <= TUNNEL_RADIUS_Y);
  }
  assert.equal(start.z, 0);
  assert.equal(near.z, -8 * TUNNEL_STEP);
  assert.equal(far.z, -137 * TUNNEL_STEP);
  assert.ok(far.z < near.z && near.z < start.z);
});

test("aligns tunnel cards to the spiral tangent with a quarter-turn offset", () => {
  const tolerance = 1e-12;
  assert.ok(Math.abs(tunnelPose(0).rotationZ - (Math.PI / 2)) < tolerance);
  const index = 8;
  const angle = (index * Math.PI * 2 / 8) + (Math.floor(index / 8) * 0.095);
  assert.ok(Math.abs(tunnelPose(index).rotationZ - (angle + (Math.PI / 2))) < tolerance);
});

test("keeps the largest accepted tunnel pose finite", () => {
  const pose = tunnelPose(Number.MAX_SAFE_INTEGER);
  assert.ok(Number.isFinite(pose.x));
  assert.ok(Number.isFinite(pose.y));
  assert.ok(Number.isFinite(pose.z));
  assert.ok(Number.isFinite(pose.rotationZ));
  assert.deepEqual(tunnelPose(Number.MAX_SAFE_INTEGER), pose);
});

test("rejects unsafe and otherwise invalid tunnel pose indexes", () => {
  for (const index of [-1, 1.5, NaN, Infinity, Number.MAX_VALUE, "1", null]) {
    assert.throws(() => tunnelPose(index), RangeError);
  }
});
