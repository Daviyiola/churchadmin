import puppeteerCore, { type Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

let cachedBrowser: Browser | null = null;
let cachedExecPath: string | null = null;

// ✅ prevents concurrent launch() calls
let launching: Promise<Browser> | null = null;

async function ensureAlive(b: Browser): Promise<boolean> {
  try {
    await b.version();
    return true;
  } catch {
    return false;
  }
}

export async function launchBrowser(): Promise<Browser> {
  if (cachedBrowser && (await ensureAlive(cachedBrowser))) return cachedBrowser;

  if (launching) return launching;

  launching = (async () => {
    if (isServerless) {
      const remotePack = process.env.CHROMIUM_REMOTE_EXEC_PATH;
      if (!remotePack) throw new Error("Missing CHROMIUM_REMOTE_EXEC_PATH.");

      if (!cachedExecPath) cachedExecPath = await chromium.executablePath(remotePack);

      const b = await puppeteerCore.launch({
        args: chromium.args,
        executablePath: cachedExecPath,
        headless: true,
        defaultViewport: { width: 1280, height: 720 },
      });

      b.on("disconnected", () => {
        cachedBrowser = null;
      });

      cachedBrowser = b;
      return b;
    }

    const puppeteer = await import("puppeteer");
    const b = await puppeteer.launch({ headless: true });

    b.on("disconnected", () => {
      cachedBrowser = null;
    });

    cachedBrowser = b;
    return b;
  })();

  try {
    return await launching;
  } finally {
    launching = null;
  }
}
