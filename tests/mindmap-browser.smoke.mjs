import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'reduce',
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.goto('http://localhost:8080/#archive', { waitUntil: 'networkidle' });
assert.equal(await page.locator('[data-mindmap-root]').count(), 1);
assert.equal(await page.locator('.mindmap-particle').count(), 72);

await page.locator('[data-mindmap-root]').click();
assert.equal(await page.locator('.mindmap-node.is-category').count(), 4);
await page.locator('.mindmap-node.is-category').first().click();
assert.ok(await page.locator('.mindmap-node:not(.is-category)').count() >= 1);
assert.ok(await page.locator('.mindmap-edge').count() >= 2);

const viewport = page.locator('[data-mindmap-viewport]');
const box = await viewport.boundingBox();
await page.mouse.move(box.x + 500, box.y + 350);
await page.mouse.down();
await page.mouse.move(box.x + 760, box.y + 530, { steps: 5 });
await page.mouse.up();
const dragged = await page.locator('[data-mindmap-world]').evaluate((element) => element.style.transform);
await page.locator('[data-mindmap-action="overview"]').click();
await page.waitForTimeout(100);
const overview = await page.locator('[data-mindmap-world]').evaluate((element) => element.style.transform);
assert.notEqual(overview, dragged);

await page.mouse.move(box.x + 450, box.y + 320);
await page.mouse.down();
await page.mouse.move(box.x + 250, box.y + 180, { steps: 5 });
await page.mouse.up();
const redragged = await page.locator('[data-mindmap-world]').evaluate((element) => element.style.transform);
await page.locator('[data-mindmap-action="restore"]').click();
await page.waitForTimeout(100);
const restored = await page.locator('[data-mindmap-world]').evaluate((element) => element.style.transform);
assert.notEqual(restored, redragged);

assert.deepEqual(errors, []);

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
const watchLine = page.locator('.watch-film [data-character-motion]');
const characters = watchLine.locator('.motion-character');
const firstCharacter = await characters.first().boundingBox();
const lastCharacter = await characters.last().boundingBox();
assert.ok(lastCharacter.x > firstCharacter.x + 30, 'watch-film Chinese label should read horizontally');
assert.ok(Math.abs(lastCharacter.y - firstCharacter.y) < 5, 'watch-film characters should stay on one line');

await browser.close();
console.log('mindmap browser smoke passed');
