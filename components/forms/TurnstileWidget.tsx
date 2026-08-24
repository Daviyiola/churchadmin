"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const TEST_SITE_KEY = "1x00000000000000000000AA";

export default function TurnstileWidget({
  onToken,
  resetSignal,
}: {
  onToken: (token: string) => void;
  resetSignal: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [message, setMessage] = useState("Running a quick security check…");
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    || (process.env.NODE_ENV !== "production" ? TEST_SITE_KEY : "");

  useEffect(() => {
    if (!scriptReady || !siteKey || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: "public_form_submit",
      appearance: "interaction-only",
      size: "flexible",
      theme: "auto",
      callback: (token: string) => {
        onToken(token);
        setMessage("Security check complete.");
      },
      "expired-callback": () => {
        onToken("");
        setMessage("Refreshing the security check…");
      },
      "error-callback": () => {
        onToken("");
        setMessage("The security check could not finish. Please try again.");
      },
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [onToken, scriptReady, siteKey]);

  useEffect(() => {
    if (!resetSignal || !widgetIdRef.current || !window.turnstile) return;
    onToken("");
    setMessage("Refreshing the security check…");
    window.turnstile.reset(widgetIdRef.current);
  }, [onToken, resetSignal]);

  if (!siteKey) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      This form&apos;s security check is not configured.
    </div>;
  }

  return <div className="space-y-2">
    <Script
      src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      strategy="afterInteractive"
      onReady={() => setScriptReady(true)}
      onError={() => setMessage("The security check could not load. Please refresh the page.")}
    />
    <div ref={containerRef} className="min-h-1 w-full" />
    <p className="text-xs text-slate-500" aria-live="polite">{message}</p>
  </div>;
}
