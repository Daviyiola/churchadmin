"use client";

import { useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

export default function QrCodeBox({
  url,
  title = "Scan to fill the form",
}: {
  url: string;
  title?: string;
}) {
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [toast, setToast] = useState("");

  const safeUrl = useMemo(() => url?.trim() ?? "", [url]);

  async function copy() {
    if (!safeUrl) return;
    await navigator.clipboard.writeText(safeUrl);
    setToast("Copied link");
    window.setTimeout(() => setToast(""), 1200);
  }

  function downloadPng() {
    const canvas = canvasWrapRef.current?.querySelector("canvas");
    if (!canvas) return;

    const pngUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = "intake-qr.png";
    a.click();
  }

  return (
    <div className="rounded-3xl border bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs text-slate-600">
            Guests can scan this QR code to open the form.
          </div>
        </div>

        {toast ? (
          <div className="rounded-2xl border bg-white px-3 py-2 text-xs shadow-sm">
            {toast}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div
          ref={canvasWrapRef}
          className="rounded-2xl border bg-slate-50 p-4 inline-flex"
        >
          <QRCodeCanvas value={safeUrl || " "} size={180} includeMargin />
        </div>

        <div className="flex-1">
          <div className="text-xs font-semibold text-slate-600">Link</div>
          <div className="mt-2 flex gap-2">
            <input
              readOnly
              value={safeUrl}
              className="flex-1 rounded-2xl border px-3 py-2 text-sm"
            />
            <button
              className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              onClick={copy}
              disabled={!safeUrl}
            >
              Copy
            </button>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
              onClick={downloadPng}
              disabled={!safeUrl}
            >
              Download QR
            </button>
          </div>

          <div className="mt-2 text-xs text-slate-500">
            Tip: put this on a projector or print it.
          </div>
        </div>
      </div>
    </div>
  );
}
