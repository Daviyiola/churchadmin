"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth";

type CloseBehavior = "signout" | "dismiss";

type ModalState =
  | { open: false }
  | {
      open: true;
      title: string;
      body: React.ReactNode;
      closeBehavior: CloseBehavior;
    };

type ModalAPI = {
  openModal: (args: {
    title: string;
    body: React.ReactNode;
    closeBehavior?: CloseBehavior; // default signout
  }) => void;
  closeModal: () => void;
};

const ModalCtx = createContext<ModalAPI | null>(null);

export function useGlobalModal() {
  const ctx = useContext(ModalCtx);
  if (!ctx) throw new Error("useGlobalModal must be used within GlobalModalProvider");
  return ctx;
}

export function GlobalModalProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>({ open: false });

  async function closeModal() {
    if (!modal.open) return;

    const behavior = modal.closeBehavior;

    setModal({ open: false });

    if (behavior === "signout") {
      await signOut();
      router.push("/signin");
    }
  }

    const api: ModalAPI = {
    openModal: ({ title, body, closeBehavior }) =>
        setModal({
        open: true,
        title,
        body,
        closeBehavior: closeBehavior ?? "signout",
        }),
    closeModal,
    };

  return (
    <ModalCtx.Provider value={api}>
      {children}

      {/* Global modal UI */}
      {modal.open ? (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">{modal.title}</div>
                <div className="mt-1 text-sm text-slate-600">
                  {modal.closeBehavior === "signout"
                    ? "Closing will sign you out."
                    : " "}
                </div>
              </div>

              <button
                onClick={closeModal}
                className="rounded-2xl border px-3 py-1 text-sm hover:bg-slate-50"
              >
                {modal.closeBehavior === "signout" ? "Sign out" : "Close"}
              </button>
            </div>

            <div className="mt-5">{modal.body}</div>
          </div>

          {/* Click outside closes too (same behavior) */}
          <button
            aria-label="Backdrop"
            onClick={closeModal}
            className="fixed inset-0 -z-10 cursor-default"
          />
        </div>
      ) : null}
    </ModalCtx.Provider>
  );
}
