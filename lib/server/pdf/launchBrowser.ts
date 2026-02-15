import puppeteerCore, { type Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

const isServerless =
  !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

let cachedBrowser: Browser | null = null;
let cachedExecPath: string | null = null;

async function ensureAlive(b: Browser): Promise<boolean> {
  try {
    // isConnected() is deprecated in newer puppeteer types, so just rely on a real call:
    await b.version();
    return true;
  } catch {
    return false;
  }
}

export async function launchBrowser(): Promise<Browser> {
  if (cachedBrowser && (await ensureAlive(cachedBrowser))) return cachedBrowser;

  cachedBrowser = null;

  if (isServerless) {
    const remotePack = process.env.CHROMIUM_REMOTE_EXEC_PATH;
    if (!remotePack) throw new Error("Missing CHROMIUM_REMOTE_EXEC_PATH.");

    if (!cachedExecPath) {
      cachedExecPath = await chromium.executablePath(remotePack);
    }

    cachedBrowser = await puppeteerCore.launch({
      args: chromium.args,
      executablePath: cachedExecPath,
      headless: true, // chromium-min doesn't expose chromium.headless
      defaultViewport: { width: 1280, height: 720 }, // chromium-min doesn't expose defaultViewport
    });

    cachedBrowser.on("disconnected", () => {
      cachedBrowser = null;
    });

    return cachedBrowser;
  }

  // Local dev: use full puppeteer (bundles Chrome)
  const puppeteer = await import("puppeteer");
  cachedBrowser = await puppeteer.launch({ headless: true });

  cachedBrowser.on("disconnected", () => {
    cachedBrowser = null;
  });

  return cachedBrowser;
}
