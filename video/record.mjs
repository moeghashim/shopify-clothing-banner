// Records the demo as two clips (desktop mouse, phone touch) plus a JSON file of step timings.
//   npm run dev            (in another terminal)
//   node video/record.mjs  [--url http://127.0.0.1:5173/?clean]
import fs from "node:fs";
import { chromium, devices } from "playwright";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const TARGET = arg("url", "http://127.0.0.1:5173/?clean");
const OUT = new globalThis.URL("./out/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

// A visible pointer, because headless recordings do not draw one.
const pointer = () => {
  window.addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.style.cssText =
      "position:fixed;left:0;top:0;border-radius:50%;background:rgba(61,70,112,.88);border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.45);z-index:99999;pointer-events:none;display:none;transition:width .08s,height .08s,margin .08s";
    document.body.appendChild(dot);
    const place = (e, down) => {
      const base = e.pointerType === "touch" ? 46 : 22;
      const size = down ? base * 0.72 : base;
      dot.style.display = "block";
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
    };
    addEventListener("pointermove", (e) => place(e, e.pressure > 0 && e.pointerType === "touch"), true);
    addEventListener("pointerdown", (e) => place(e, true), true);
    addEventListener("pointerup", (e) => {
      place(e, false);
      if (e.pointerType === "touch") dot.style.display = "none";
    }, true);
    addEventListener("pointercancel", () => (dot.style.display = "none"), true);
  });
};

const wait = (page, ms) => page.waitForTimeout(ms);
const marks = { desktop: {}, phone: {} };
const browser = await chromium.launch({ args: ["--enable-gpu-rasterization"], executablePath: process.env.CHROMIUM_PATH || undefined });
const centreOf = (page, index) =>
  page.evaluate((i) => {
    const r = document.querySelectorAll(".cr-swing")[i].getBoundingClientRect();
    return r.left + r.width / 2;
  }, index);

// ---- desktop
{
  const context = await browser.newContext({ recordVideo: { dir: OUT, size: { height: 720, width: 1280 } }, viewport: { height: 720, width: 1280 } });
  const page = await context.newPage();
  await page.addInitScript(pointer);
  const t0 = Date.now();
  const mark = (k) => (marks.desktop[k] = Math.round((Date.now() - t0) / 100) / 10);
  await page.goto(TARGET, { waitUntil: "load" });
  mark("shown");
  await wait(page, 3400);
  mark("loaded");
  const rack = await page.locator(".cr-rack").boundingBox();
  const y = rack.y + 160, left = rack.x + 40, right = rack.x + rack.width - 40;
  await page.mouse.move(left, y + 120);
  await wait(page, 300);
  await page.mouse.move(left, y, { steps: 12 });
  mark("sweepRightStart");
  for (let x = left; x <= right; x += 3) { await page.mouse.move(x, y); await wait(page, 15); }
  mark("sweepRightEnd");
  await wait(page, 700);
  mark("sweepLeftStart");
  for (let x = right; x >= left; x -= 4) { await page.mouse.move(x, y); await wait(page, 15); }
  mark("sweepLeftEnd");
  await wait(page, 500);
  await page.mouse.move(rack.x + rack.width / 2, y + 300, { steps: 20 });
  await wait(page, 3000);
  mark("returned");
  await page.mouse.move(await centreOf(page, 4), y, { steps: 25 });
  await wait(page, 1800);
  mark("click");
  await page.mouse.down(); await wait(page, 90); await page.mouse.up();
  await wait(page, 2600);
  await page.getByRole("button", { name: "Close" }).click();
  await wait(page, 1200);
  mark("end");
  const clip = await page.video().path();
  await context.close();
  fs.renameSync(clip, `${OUT}desktop.webm`);
}

// ---- phone
{
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    recordVideo: { dir: OUT, size: { height: 844, width: 390 } },
    viewport: { height: 844, width: 390 },
  });
  const page = await context.newPage();
  await page.addInitScript(pointer);
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", { touchPoints: type === "touchEnd" ? [] : [{ force: 1, id: 1, x, y }], type });
  const t0 = Date.now();
  const mark = (k) => (marks.phone[k] = Math.round((Date.now() - t0) / 100) / 10);
  await page.goto(TARGET, { waitUntil: "load" });
  mark("shown");
  await wait(page, 3000);
  mark("loaded");
  const r = await page.evaluate(() => {
    const u = document.querySelector(".cr-rack").getBoundingClientRect();
    return { l: u.left, r: u.right, y: u.top + 80 };
  });
  mark("dragRightStart");
  await touch("touchStart", r.l + 8, r.y);
  for (let x = r.l + 8; x <= r.r - 8; x += 3) { await touch("touchMove", x, r.y); await wait(page, 24); }
  await touch("touchEnd");
  mark("dragRightEnd");
  await wait(page, 900);
  mark("swipeLeftStart");
  await touch("touchStart", r.r - 8, r.y);
  for (let x = r.r - 8; x >= r.l + 8; x -= 8) { await touch("touchMove", x, r.y); await wait(page, 18); }
  await touch("touchEnd");
  mark("swipeLeftEnd");
  await wait(page, 900);
  const target = await centreOf(page, 2);
  await touch("touchStart", r.l + 8, r.y);
  for (let x = r.l + 8; x <= target; x += 4) { await touch("touchMove", x, r.y); await wait(page, 20); }
  await touch("touchEnd");
  await wait(page, 1200);
  mark("tap");
  await page.touchscreen.tap(target, r.y);
  await wait(page, 2600);
  await page.getByRole("button", { name: "Close" }).tap();
  await wait(page, 1000);
  mark("end");
  const clip = await page.video().path();
  await context.close();
  fs.renameSync(clip, `${OUT}phone.webm`);
}

fs.writeFileSync(`${OUT}marks.json`, JSON.stringify(marks, null, 2));
await browser.close();
console.log("recorded", marks);
