"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  X,
  LogOut,
} from "lucide-react";
import { PublicSessionDTO } from "@/lib/types";

interface AccountSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: PublicSessionDTO;
  onSessionUpdated: () => Promise<void>;
  darkMode: boolean;
}

export function AccountSetupModal({
  isOpen,
  onClose,
  session,
  onSessionUpdated,
  darkMode,
}: AccountSetupModalProps) {
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [showCustomCreds, setShowCustomCreds] = useState(
    !session.hasApiCredentials
  );
  const [loginCode, setLoginCode] = useState("");
  const [twoFaPassword, setTwoFaPassword] = useState("");
  const [step, setStep] = useState<"credentials" | "code" | "2fa">(
    session.status === "AWAITING_CODE"
      ? "code"
      : session.status === "AWAITING_2FA"
      ? "2fa"
      : "credentials"
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSendLiveCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_code",
          apiId: apiId ? Number(apiId) : undefined,
          apiHash: apiHash || undefined,
          phoneNumber: phoneNumber || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send Telegram code");
      setStep("code");
      setSuccessMsg(data.message);
      await onSessionUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to request code");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyLiveCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify_code",
          code: loginCode,
          password: twoFaPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      if (data.status === "AWAITING_2FA") {
        setStep("2fa");
        setSuccessMsg(data.message);
      } else {
        setSuccessMsg(data.message);
        setLoginCode("");
        setTwoFaPassword("");
        setApiHash("");
        await onSessionUpdated();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification error");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    setError(null);
    try {
      await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      setSuccessMsg("Telegram account disconnected.");
      await onSessionUpdated();
    } catch {
      setError("Failed to disconnect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl ${
          darkMode
            ? "bg-slate-900 border-slate-800 text-slate-100"
            : "bg-white border-slate-200 text-slate-900"
        }`}
      >
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            darkMode ? "border-slate-800" : "border-slate-100"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold">Telegram Account Connection</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div
            className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
              session.status === "CONNECTED"
                ? darkMode
                  ? "bg-emerald-950/30 border-emerald-500/30"
                  : "bg-emerald-50 border-emerald-200"
                : darkMode
                ? "bg-slate-800/60 border-slate-700"
                : "bg-slate-50 border-slate-200"
            }`}
          >
            <div>
              <div className="text-sm font-bold">
                {session.status === "CONNECTED"
                  ? `Connected: ${session.firstName || "Telegram User"}`
                  : `Not Connected (${session.firstName || "Reconnect needed"})`}
              </div>
              <div className="text-xs text-slate-400 font-mono mt-0.5">
                {session.maskedPhone}
              </div>
            </div>

            {session.status === "CONNECTED" && (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Disconnect
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {step === "credentials" ? (
            <form onSubmit={handleSendLiveCode} className="space-y-3">
              {session.hasApiCredentials && !showCustomCreds ? (
                <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700 text-xs space-y-2">
                  <div className="text-slate-200 font-medium">
                    Saved Account: <strong>{session.firstName}</strong> (
                    {session.maskedPhone})
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCustomCreds(true)}
                    className="text-emerald-400 hover:underline text-[11px] cursor-pointer"
                  >
                    Use different api_id / phone number
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Telegram api_id (my.telegram.org)
                    </label>
                    <input
                      type="number"
                      required={!session.hasApiCredentials}
                      value={apiId}
                      onChange={(e) => setApiId(e.target.value)}
                      placeholder="e.g. 33510851"
                      className={`w-full px-3 py-2 rounded-lg text-sm border font-mono ${
                        darkMode
                          ? "bg-slate-950 border-slate-800"
                          : "bg-slate-50 border-slate-300"
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Telegram api_hash
                    </label>
                    <input
                      type="password"
                      required={!session.hasApiCredentials}
                      value={apiHash}
                      onChange={(e) => setApiHash(e.target.value)}
                      placeholder="32-character api_hash"
                      className={`w-full px-3 py-2 rounded-lg text-sm border font-mono ${
                        darkMode
                          ? "bg-slate-950 border-slate-800"
                          : "bg-slate-50 border-slate-300"
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Phone Number
                    </label>
                    <input
                      type="text"
                      required={!session.hasApiCredentials}
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+998 93 659 01 10"
                      className={`w-full px-3 py-2 rounded-lg text-sm border font-mono ${
                        darkMode
                          ? "bg-slate-950 border-slate-800"
                          : "bg-slate-50 border-slate-300"
                      }`}
                    />
                  </div>
                </>
              )}
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer disabled:opacity-50"
                >
                  {loading
                    ? "Sending Code..."
                    : "Telegramga Kod Yuborish (Send Code)"}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyLiveCode} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  Telegram Login Code (5 digits)
                </label>
                <input
                  type="text"
                  value={loginCode}
                  onChange={(e) => setLoginCode(e.target.value)}
                  placeholder="12345"
                  className={`w-full px-3 py-2 rounded-lg text-sm border font-mono ${
                    darkMode
                      ? "bg-slate-950 border-slate-800"
                      : "bg-slate-50 border-slate-300"
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  2FA Password (only if enabled on your Telegram)
                </label>
                <input
                  type="password"
                  value={twoFaPassword}
                  onChange={(e) => setTwoFaPassword(e.target.value)}
                  placeholder="Optional 2FA Password"
                  className={`w-full px-3 py-2 rounded-lg text-sm border ${
                    darkMode
                      ? "bg-slate-950 border-slate-800"
                      : "bg-slate-50 border-slate-300"
                  }`}
                />
              </div>
              <div className="flex justify-between items-center pt-2">
                <button
                  type="button"
                  onClick={() => setStep("credentials")}
                  className="text-xs text-slate-400 hover:underline cursor-pointer"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer disabled:opacity-50"
                >
                  {loading ? "Verifying..." : "Verify & Connect"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
