#!/usr/bin/env node
// Screenshots the built playground in dark and light theme and reports console errors.
// Usage: pnpm build && node scripts/screenshot.mjs
// First time on a new machine: pnpm exec playwright install chromium
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".screenshots");
const port = Number(process.env.OPSKIT_PREVIEW_PORT ?? 4174);
const url = `http://localhost:${port}/`;

if (!existsSync(join(root, "apps/playground/dist/index.html"))) {
  console.error("apps/playground/dist is missing. Run `pnpm build` first.");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const server = spawn("pnpm", ["--filter", "@opskit/playground", "exec", "vite", "preview", "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: "ignore",
});

let exitCode = 0;
try {
  await waitFor(url, 20_000);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));

  // Chat: ask the scripted question, let the agent stream its answer and the mock Gateway respond.
  await page.goto(url);
  // Full-page shots stitch the page together; sticky bars would land mid-page.
  await page.addStyleTag({ content: ".sticky { position: static !important; }" });
  await page.getByRole("button", { name: "Why is checkout slow?" }).click();
  await page.waitForTimeout(9000);
  await page.screenshot({ path: join(outDir, "chat-dark.png"), fullPage: true });

  // Gallery: every component in every state; stale needs one failed refresh.
  await page.getByRole("button", { name: "gallery" }).click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(outDir, "gallery-dark.png"), fullPage: true });

  // Probe: the form before a run, so this needs no Gateway.
  await page.getByRole("button", { name: "probe" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(outDir, "probe-dark.png"), fullPage: true });

  await page.getByRole("button", { name: /switch to light theme/i }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, "probe-light.png"), fullPage: true });
  await page.getByRole("button", { name: "gallery" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(outDir, "gallery-light.png"), fullPage: true });
  await page.getByRole("button", { name: "chat" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, "chat-light.png"), fullPage: true });
  await browser.close();

  console.log(`Wrote chat, gallery and probe .png (dark + light) to ${outDir}`);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    exitCode = 1;
  } else {
    console.log("No console errors.");
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  server.kill();
}
process.exit(exitCode);

async function waitFor(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(target);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Playground preview did not start on ${target}`);
}
