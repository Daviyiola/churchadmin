import puppeteerCore, { type Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

const isServerless =
  !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

let cachedBrowser: Browser | null = null;
let cachedExecPath: string | null = null;

async function ensureAlive(b: Browser): Promise<boolean> {
  try {
    // Fast check
    if (!b.isConnected()) return false;
    // Stronger check (sometimes isConnected is true but transport is dead)
    await b.version();
    return true;
  } catch {
    return false;
  }
}

export async function launchBrowser(): Promise<Browser> {
  if (cachedBrowser && (await ensureAlive(cachedBrowser))) return cachedBrowser;

  // cachedBrowser exists but dead
  cachedBrowser = null;

  if (isServerless) {
    const remotePack = process.env.CHROMIUM_REMOTE_EXEC_PATH;
    if (!remotePack) {
      throw new Error("Missing CHROMIUM_REMOTE_EXEC_PATH in production.");
    }

    if (!cachedExecPath) cachedExecPath = await chromium.executablePath(remotePack);

    cachedBrowser = await puppeteerCore.launch({
      args: chromium.args,
      executablePath: cachedExecPath,
      headless: true,
      defaultViewport: { width: 1280, height: 720 },
    });

    // Auto-reset if it disconnects
    cachedBrowser.on("disconnected", () => {
      cachedBrowser = null;
    });

    return cachedBrowser;
  }

  const puppeteer = await import("puppeteer");
  cachedBrowser = await puppeteer.launch({ headless: true });
  cachedBrowser.on("disconnected", () => {
    cachedBrowser = null;
  });
  return cachedBrowser;
}
