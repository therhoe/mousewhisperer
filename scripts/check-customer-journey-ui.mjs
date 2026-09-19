// Against scripts/preview-customer-journeys.mjs only. No merchant data or accounts.
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const click = async (text, within = "body") => {
  await page.waitForFunction(
    (text, within) =>
      [...document.querySelector(within).querySelectorAll("button")].some(
        (b) => b.textContent.trim() === text,
      ),
    {},
    text,
    within,
  );
  await page.evaluate(
    (text, within) =>
      [...document.querySelector(within).querySelectorAll("button")]
        .find((b) => b.textContent.trim() === text)
        .click(),
    text,
    within,
  );
};
const inputFor = async (label) =>
  "#" +
  (await page.evaluate(
    (text) =>
      CSS.escape(
        [...document.querySelectorAll("label")].find(
          (l) => l.textContent.trim() === text,
        )?.htmlFor,
      ),
    label,
  ));
try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:4183/app/customer-snapshots", {
    waitUntil: "networkidle0",
  });
  await click("Start customer snapshot");
  await click("Start snapshot", '[role="dialog"]');
  await page.waitForFunction(() =>
    document.body.textContent.includes(
      "Enter a snapshot name and landing URL.",
    ),
  );
  await page.type(await inputFor("Snapshot name"), "Facebook ad journeys");
  await page.type(
    await inputFor("Landing page or existing campaign link"),
    "https://store.example/products/shoe?utm_source=facebook&utm_medium=paid_social&utm_campaign=summer_sale&ad_id=123&utm_content=creative-1",
  );
  assert.equal(
    await page.$eval(await inputFor("Ad ID"), (el) => el.value),
    "123",
  );
  await click("Check link tags");
  await page.waitForFunction(() =>
    document.body.textContent.includes("The link matches this snapshot"),
  );
  await click("Start snapshot", '[role="dialog"]');
  await page.waitForFunction(() =>
    document.body.textContent.includes("Journey overview"),
  );
  assert.equal(await page.$$eval("tbody tr", (rows) => rows.length), 10);
  await page.screenshot({
    path: "/tmp/customer-journey-desktop.png",
    fullPage: true,
  });
  await click("View journey");
  await page.waitForFunction(() =>
    document
      .querySelector('[role="dialog"]')
      ?.textContent.includes("35 recorded events"),
  );
  assert.equal(
    await page.$$eval('[role="dialog"] ol li', (items) => items.length),
    30,
  );
  await page.click('[role="dialog"] button[aria-label="Next"]');
  await page.waitForFunction(() =>
    document
      .querySelector('[role="dialog"]')
      ?.textContent.includes("Page 2 of 2"),
  );
  assert.equal(
    await page.$$eval('[role="dialog"] ol li', (items) => items.length),
    5,
  );
  await page.screenshot({
    path: "/tmp/customer-journey-timeline.png",
    fullPage: true,
  });
  await page.click('[role="dialog"] button[aria-label="Close"]');
  await click("Pause snapshot");
  await page.waitForFunction(() =>
    document.body.textContent.includes("Page and click collection is paused"),
  );
  await click("Resume snapshot");
  await page.waitForFunction(() =>
    document.body.textContent.includes("Pause snapshot"),
  );
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/customer-journey-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Mobile viewport should not overflow horizontally",
  );
  await click("View journey");
  await page.waitForFunction(() =>
    document
      .querySelector('[role="dialog"]')
      ?.textContent.includes("35 recorded events"),
  );
  await page.screenshot({
    path: "/tmp/customer-journey-mobile-timeline.png",
    fullPage: true,
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "Passed: creation validation, tagged-link import, link check, session pagination size, lazy timeline pagination, pause/resume, desktop and 390px layout, no browser errors.",
  );
} finally {
  await browser.close();
}
