"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  MessageSquareText,
  Users,
  Inbox,
  Sun,
  Moon,
  RotateCcw,
  Plus,
  Trash2,
  PauseCircle,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Edit3,
  UserPlus,
  Radio,
} from "lucide-react";
import {
  PublicSessionDTO,
  SafetyConfigRecord,
  SegmentRecord,
  ContactRecord,
  RepliedHistoryRecord,
  MessageLogRecord,
  ReplyCooldownMode,
} from "@/lib/types";
import { AccountSetupModal } from "@/components/AccountSetupModal";

type ActiveTab = "messages" | "contacts" | "templates";

export default function SafeReplyDashboard() {
  const [darkMode, setDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>("messages");
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);

  const [session, setSession] = useState<PublicSessionDTO | null>(null);
  const [safetyConfig, setSafetyConfig] = useState<SafetyConfigRecord | null>(
    null
  );
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [repliedHistory, setRepliedHistory] = useState<RepliedHistoryRecord[]>(
    []
  );
  const [messageLogs, setMessageLogs] = useState<MessageLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Templates state
  const [editingTemplates, setEditingTemplates] = useState<
    Record<string, string>
  >({});
  const [savingSegmentId, setSavingSegmentId] = useState<string | null>(null);

  // Tanlangan Odamlar form state (No Telegram ID required!)
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState({
    telegramUserId: "",
    username: "",
    firstName: "",
    segmentId: "seg-vip",
    customTemplate: "",
    isPaused: false,
  });

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setSession(data.session);
      setSafetyConfig(data.safetyConfig);
      setSegments(data.segments);
      setContacts(data.contacts);
      setRepliedHistory(data.repliedHistory);
      setMessageLogs(data.messageLogs);

      setEditingTemplates((prev) => {
        const next = { ...prev };
        for (const seg of data.segments as SegmentRecord[]) {
          if (next[seg.id] === undefined) {
            next[seg.id] = seg.template;
          }
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to fetch state:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 4000);
    return () => clearInterval(interval);
  }, [fetchState]);

  const handleUpdateSafety = async (patch: Partial<SafetyConfigRecord>) => {
    try {
      const res = await fetch("/api/safety", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok) {
        setSafetyConfig(data.safetyConfig);
        setSession(data.session);
        notify("Updated successfully");
      }
    } catch {
      notify("Failed to update setting");
    }
  };

  const handleResetRepliedHistory = async (telegramUserId?: string) => {
    try {
      const url = telegramUserId
        ? `/api/history?telegramUserId=${encodeURIComponent(telegramUserId)}`
        : "/api/history";
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setRepliedHistory(data.repliedHistory);
        notify(
          telegramUserId
            ? "Qayta javob berish yoqildi"
            : "Barcha foydalanuvchilar uchun qayta javob yangilandi"
        );
      }
    } catch {
      notify("Failed to reset history");
    }
  };

  const handleSaveTemplate = async (segmentId: string) => {
    setSavingSegmentId(segmentId);
    try {
      const template = editingTemplates[segmentId] ?? "";
      const res = await fetch("/api/segments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: segmentId, template }),
      });
      const data = await res.json();
      if (res.ok) {
        setSegments(data.segments);
        notify("Shablon saqlandi");
      }
    } catch {
      notify("Failed to save template");
    } finally {
      setSavingSegmentId(null);
    }
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingContactId || undefined,
          ...contactForm,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setContacts(data.contacts);
        setShowContactForm(false);
        setEditingContactId(null);
        setContactForm({
          telegramUserId: "",
          username: "",
          firstName: "",
          segmentId: "seg-vip",
          customTemplate: "",
          isPaused: false,
        });
        notify("Tanlangan odamlarga saqlandi");
      }
    } catch {
      notify("Xatolik yuz berdi");
    }
  };

  const handleToggleContactPause = async (contact: ContactRecord) => {
    try {
      const res = await fetch("/api/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: contact.id,
          isPaused: !contact.isPaused,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setContacts(data.contacts);
        notify(
          !contact.isPaused
            ? `${contact.firstName} uchun avto-javob to‘xtatildi`
            : `${contact.firstName} uchun avto-javob yoqildi`
        );
      }
    } catch {
      notify("Failed to update contact");
    }
  };

  const handleDeleteContact = async (id: string) => {
    try {
      const res = await fetch(`/api/contacts?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        setContacts(data.contacts);
        notify("O‘chirildi");
      }
    } catch {
      notify("Failed to delete contact");
    }
  };

  const handleAddSenderToVIP = (log: MessageLogRecord) => {
    setEditingContactId(null);
    setContactForm({
      telegramUserId: log.telegramUserId,
      username: log.username || "",
      firstName: log.firstName,
      segmentId: "seg-vip",
      customTemplate: "",
      isPaused: false,
    });
    setActiveTab("contacts");
    setShowContactForm(true);
  };

  if (loading || !session || !safetyConfig) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center text-sm text-slate-400">
        Loading...
      </div>
    );
  }

  const isAutoReplyActive =
    safetyConfig.autoReplyEnabled && !safetyConfig.emergencyStop;

  return (
    <div
      className={`min-h-screen ${
        darkMode ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900"
      }`}
    >
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold shadow-xl">
          {toast}
        </div>
      )}

      {/* Clean Top Control Bar */}
      <header
        className={`border-b ${
          darkMode
            ? "bg-slate-900 border-slate-800"
            : "bg-white border-slate-200"
        }`}
      >
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          {/* Connected Telegram User */}
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                isAutoReplyActive
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                  : "bg-amber-500/15 border-amber-500/30 text-amber-400"
              }`}
            >
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">
                  {session.status === "CONNECTED"
                    ? session.firstName || "Telegram Connected"
                    : "Telegram Ulanmagan (Not Connected)"}
                </span>
                <button
                  onClick={() => setIsAccountModalOpen(true)}
                  className="px-2.5 py-0.5 rounded-lg text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 font-semibold cursor-pointer"
                >
                  {session.status === "CONNECTED"
                    ? session.maskedPhone
                    : "Ulash / Kod yuborish →"}
                </button>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {session.status !== "CONNECTED"
                  ? "Telegram sessiya uzilgan — qayta ulash uchun yuqoridagi tugmani bosing"
                  : !isAutoReplyActive
                  ? "Auto-Reply: To‘xtatilgan (PAUSED)"
                  : safetyConfig.pauseWhenOwnerOnline !== false &&
                    session.ownerCurrentlyInTelegram
                  ? "Siz hozir Telegramdasiz (Avto-javob vaqtincha kutish rejimida)"
                  : "Auto-Reply: Yoqiq (Telegramdan chiqsangiz avtomatik javob beradi)"}
              </div>
            </div>
          </div>

          {/* Core Controls: Pause/Enable Auto-Reply + Smart Mode + 24/7 Online + Reset Reply-Once */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() =>
                handleUpdateSafety({
                  autoReplyEnabled: !isAutoReplyActive,
                })
              }
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                isAutoReplyActive
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25"
                  : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
              }`}
            >
              {isAutoReplyActive ? (
                <>
                  <PauseCircle className="w-4 h-4" />
                  <span>Pause Auto-Reply</span>
                </>
              ) : (
                <>
                  <PlayCircle className="w-4 h-4" />
                  <span>Turn ON Auto-Reply</span>
                </>
              )}
            </button>

            <button
              onClick={() =>
                handleUpdateSafety({
                  pauseWhenOwnerOnline:
                    safetyConfig.pauseWhenOwnerOnline === false ? true : false,
                })
              }
              title="Telegramga kirganingizda avto-javob o‘chadi, chiqqaningizda avtomatik yoqiladi"
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                safetyConfig.pauseWhenOwnerOnline !== false
                  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                  : darkMode
                  ? "bg-slate-800 text-slate-400 border-slate-700"
                  : "bg-slate-100 text-slate-600 border-slate-300"
              }`}
            >
              <span>
                Smart Rejim (Kirsam o‘chsin):{" "}
                {safetyConfig.pauseWhenOwnerOnline !== false ? "ON" : "OFF"}
              </span>
            </button>

            <button
              onClick={() =>
                handleUpdateSafety({
                  online247Enabled: !safetyConfig.online247Enabled,
                })
              }
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                safetyConfig.online247Enabled
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : darkMode
                  ? "bg-slate-800 text-slate-400 border-slate-700"
                  : "bg-slate-100 text-slate-600 border-slate-300"
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>
                24/7 Online: {safetyConfig.online247Enabled ? "ON" : "OFF"}
              </span>
            </button>

            <button
              onClick={() => handleResetRepliedHistory()}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                darkMode
                  ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300"
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Reply-Once ({repliedHistory.length})</span>
            </button>

            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded-xl border cursor-pointer ${
                darkMode
                  ? "bg-slate-800 border-slate-700 text-amber-300"
                  : "bg-slate-100 border-slate-300 text-slate-700"
              }`}
            >
              {darkMode ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Simple 3-Tab Bar */}
        <div className="max-w-5xl mx-auto px-4 flex items-center gap-2">
          <button
            onClick={() => setActiveTab("messages")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 cursor-pointer ${
              activeTab === "messages"
                ? "border-emerald-400 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Inbox className="w-4 h-4" />
            <span>Kelgan Xabarlar ({messageLogs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("contacts")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 cursor-pointer ${
              activeTab === "contacts"
                ? "border-emerald-400 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Tanlangan Odamlar ({contacts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("templates")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 cursor-pointer ${
              activeTab === "templates"
                ? "border-emerald-400 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <MessageSquareText className="w-4 h-4" />
            <span>Message Templates</span>
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* ================================================================= */}
        {/* 1. KELGAN XABARLAR (WHAT THEY SENT ME & AUTO-REPLIES)             */}
        {/* ================================================================= */}
        {activeTab === "messages" && (
          <div className="space-y-4">
            {messageLogs.length === 0 ? (
              <div
                className={`p-10 text-center rounded-2xl border ${
                  darkMode
                    ? "bg-slate-900/60 border-slate-800 text-slate-400"
                    : "bg-white border-slate-200 text-slate-500"
                }`}
              >
                <p className="text-sm font-medium">
                  Hozircha xabarlar yo‘q. Telegramdan kimdir yozsa shu yerda
                  chiqadi.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {messageLogs.map((log) => {
                  const isRepliedLocked = repliedHistory.some(
                    (r) => r.telegramUserId === log.telegramUserId
                  );
                  const isAlreadyInContacts = contacts.some(
                    (c) =>
                      c.telegramUserId === log.telegramUserId ||
                      c.firstName.toLowerCase() === log.firstName.toLowerCase()
                  );

                  return (
                    <div
                      key={log.id}
                      className={`p-4 rounded-2xl border flex flex-col gap-3 ${
                        darkMode
                          ? "bg-slate-900/70 border-slate-800"
                          : "bg-white border-slate-200 shadow-sm"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">
                            {log.firstName}
                          </span>
                          {log.username && (
                            <span className="text-xs font-mono text-emerald-400">
                              @{log.username}
                            </span>
                          )}
                          <span className="text-[11px] font-mono text-slate-400">
                            •{" "}
                            {new Date(log.createdAt).toLocaleTimeString(
                              "uz-UZ",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              }
                            )}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {!isAlreadyInContacts &&
                            log.chatType === "private" && (
                              <button
                                onClick={() => handleAddSenderToVIP(log)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 cursor-pointer"
                              >
                                <UserPlus className="w-3.5 h-3.5" />
                                <span>+ Tanlangan odamlarga qo‘shish</span>
                              </button>
                            )}

                          {isRepliedLocked && (
                            <button
                              onClick={() =>
                                handleResetRepliedHistory(log.telegramUserId)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Qayta javob berish</span>
                            </button>
                          )}

                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                              log.status === "DELIVERED"
                                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                : log.status === "SKIPPED_ALREADY_REPLIED"
                                ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                            }`}
                          >
                            {log.status === "DELIVERED" && (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            {log.status === "SKIPPED_ALREADY_REPLIED" && (
                              <Clock className="w-3 h-3" />
                            )}
                            {log.status !== "DELIVERED" &&
                              log.status !== "SKIPPED_ALREADY_REPLIED" && (
                                <XCircle className="w-3 h-3" />
                              )}
                            {log.status}
                          </span>
                        </div>
                      </div>

                      {/* What they sent me */}
                      <div
                        className={`p-3 rounded-xl border text-xs ${
                          darkMode
                            ? "bg-slate-950 border-slate-800"
                            : "bg-slate-50 border-slate-200"
                        }`}
                      >
                        <div className="text-[11px] font-semibold text-slate-400 mb-1">
                          Kelgan xabar ({log.firstName}):
                        </div>
                        <div className="text-sm font-medium">
                          {log.incomingText}
                        </div>
                      </div>

                      {/* What auto-reply sent back */}
                      {log.outgoingText ? (
                        <div
                          className={`p-3 rounded-xl border text-xs ${
                            darkMode
                              ? "bg-emerald-950/20 border-emerald-500/25"
                              : "bg-emerald-50 border-emerald-200"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-400 mb-1">
                            <span>Yuborilgan Avto-Javob:</span>
                            <span className="font-mono">
                              {log.totalDelayLabel}
                            </span>
                          </div>
                          <div className="text-sm">{log.outgoingText}</div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400">
                          Javob yuborilmadi: {log.reason}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* 2. TANLANGAN ODAMLAR (NO TELEGRAM ID REQUIRED!)                   */}
        {/* ================================================================= */}
        {activeTab === "contacts" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">Tanlangan Odamlar</h2>
                <p className="text-xs text-slate-400">
                  Maxsus javob oladigan odamlar yoki avto-javob o‘chirilgan
                  kontaktlar
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingContactId(null);
                  setContactForm({
                    telegramUserId: "",
                    username: "",
                    firstName: "",
                    segmentId: "seg-vip",
                    customTemplate: "",
                    isPaused: false,
                  });
                  setShowContactForm(!showContactForm);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Odam qo‘shish</span>
              </button>
            </div>

            {showContactForm && (
              <form
                onSubmit={handleSaveContact}
                className={`p-5 rounded-2xl border space-y-4 ${
                  darkMode
                    ? "bg-slate-900 border-emerald-500/40"
                    : "bg-white border-emerald-300 shadow-md"
                }`}
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Telegramdagi Ismi *
                    </label>
                    <input
                      type="text"
                      required
                      value={contactForm.firstName}
                      onChange={(e) =>
                        setContactForm({
                          ...contactForm,
                          firstName: e.target.value,
                        })
                      }
                      placeholder="Masalan: Nanajon"
                      className={`w-full px-3 py-2 rounded-lg text-xs border ${
                        darkMode
                          ? "bg-slate-950 border-slate-800"
                          : "bg-slate-50 border-slate-300"
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      @username (ixtiyoriy)
                    </label>
                    <input
                      type="text"
                      value={contactForm.username}
                      onChange={(e) =>
                        setContactForm({
                          ...contactForm,
                          username: e.target.value,
                        })
                      }
                      placeholder="ixtiyoriy"
                      className={`w-full px-3 py-2 rounded-lg text-xs font-mono border ${
                        darkMode
                          ? "bg-slate-950 border-slate-800"
                          : "bg-slate-50 border-slate-300"
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Toifa (Segment)
                    </label>
                    <select
                      value={contactForm.segmentId}
                      onChange={(e) =>
                        setContactForm({
                          ...contactForm,
                          segmentId: e.target.value,
                        })
                      }
                      className={`w-full px-3 py-2 rounded-lg text-xs font-semibold border ${
                        darkMode
                          ? "bg-slate-950 border-slate-800 text-slate-100"
                          : "bg-slate-50 border-slate-300 text-slate-900"
                      }`}
                    >
                      {segments.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">
                    Maxsus javob xabari (ixtiyoriy — faqat shu inson uchun):
                  </label>
                  <textarea
                    rows={2}
                    value={contactForm.customTemplate}
                    onChange={(e) =>
                      setContactForm({
                        ...contactForm,
                        customTemplate: e.target.value,
                      })
                    }
                    placeholder="Bo‘sh qoldirsangiz, tanlangan toifa shabloni yuboriladi..."
                    className={`w-full p-3 rounded-lg text-xs border ${
                      darkMode
                        ? "bg-slate-950 border-slate-800"
                        : "bg-slate-50 border-slate-300"
                    }`}
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowContactForm(false)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    Bekor qilish
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer"
                  >
                    Saqlash
                  </button>
                </div>
              </form>
            )}

            {contacts.length === 0 ? (
              <div
                className={`p-10 text-center rounded-2xl border ${
                  darkMode
                    ? "bg-slate-900/60 border-slate-800 text-slate-400"
                    : "bg-white border-slate-200 text-slate-500"
                }`}
              >
                <p className="text-sm font-medium">
                  Tanlangan odamlar ro‘yxati bo‘sh. &ldquo;Odam qo‘shish&rdquo;
                  tugmasi orqali yoki &ldquo;Kelgan Xabarlar&rdquo; ichidan
                  1-bosishda qo‘shishingiz mumkin.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {contacts.map((contact) => {
                  const seg = segments.find((s) => s.id === contact.segmentId);
                  return (
                    <div
                      key={contact.id}
                      className={`p-5 rounded-2xl border flex flex-col justify-between gap-4 ${
                        darkMode
                          ? "bg-slate-900/70 border-slate-800"
                          : "bg-white border-slate-200 shadow-sm"
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-sm">
                              {contact.firstName}
                            </span>
                            {contact.username && (
                              <span className="ml-2 text-xs font-mono text-emerald-400">
                                @{contact.username}
                              </span>
                            )}
                          </div>
                          <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            {seg?.name || "VIP"}
                          </span>
                        </div>

                        <div
                          className={`p-3 rounded-xl border text-xs ${
                            darkMode
                              ? "bg-slate-950 border-slate-800"
                              : "bg-slate-50 border-slate-200"
                          }`}
                        >
                          {seg?.isIgnored
                            ? "Blacklist — umuman javob yuborilmaydi."
                            : contact.customTemplate || seg?.template}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                        <button
                          onClick={() => handleToggleContactPause(contact)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${
                            contact.isPaused
                              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                              : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          }`}
                        >
                          {contact.isPaused ? (
                            <>
                              <PauseCircle className="w-3.5 h-3.5" />
                              <span>Paused (Javob o‘chiq)</span>
                            </>
                          ) : (
                            <>
                              <PlayCircle className="w-3.5 h-3.5" />
                              <span>Active (Javob yoqiq)</span>
                            </>
                          )}
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditingContactId(contact.id);
                              setContactForm({
                                telegramUserId: contact.telegramUserId,
                                username: contact.username || "",
                                firstName: contact.firstName,
                                segmentId: contact.segmentId,
                                customTemplate: contact.customTemplate || "",
                                isPaused: contact.isPaused,
                              });
                              setShowContactForm(true);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteContact(contact.id)}
                            className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* 3. MESSAGE TEMPLATES (XABAR SHABLONLARI)                          */}
        {/* ================================================================= */}
        {activeTab === "templates" && (
          <div className="space-y-5">
            <div
              className={`p-5 rounded-2xl border flex flex-wrap items-center justify-between gap-4 ${
                darkMode
                  ? "bg-slate-900/70 border-slate-800"
                  : "bg-white border-slate-200 shadow-sm"
              }`}
            >
              <div>
                <h3 className="text-sm font-bold">
                  Reply-Once (Bitta odamga necha marta avto-javob yozilsin?)
                </h3>
                <p className="text-xs text-slate-400">
                  Spam bo‘lmasligi uchun bitta foydalanuvchiga qayta-qayta javob
                  yuborilmaydi
                </p>
              </div>
              <select
                value={safetyConfig.replyCooldownMode}
                onChange={(e) =>
                  handleUpdateSafety({
                    replyCooldownMode: e.target.value as ReplyCooldownMode,
                  })
                }
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border ${
                  darkMode
                    ? "bg-slate-950 border-slate-800 text-slate-100"
                    : "bg-slate-50 border-slate-300 text-slate-900"
                }`}
              >
                <option value="EVERY_MESSAGE">
                  Har bir xabarga javob berish (Har gal yozganda)
                </option>
                <option value="NEVER">
                  Faqat 1 marta (Reset qilmaguncha qayta yozmaydi)
                </option>
                <option value="AFTER_1H">Har 1 soatda 1 marta</option>
                <option value="AFTER_24H">Har 24 soatda 1 marta</option>
                <option value="AFTER_7D">Har 7 kunda 1 marta</option>
              </select>
            </div>

            {segments
              .filter((s) => !s.isIgnored)
              .map((seg) => {
                const draft = editingTemplates[seg.id] ?? seg.template;
                return (
                  <div
                    key={seg.id}
                    className={`p-5 rounded-2xl border space-y-3 ${
                      darkMode
                        ? "bg-slate-900/70 border-slate-800"
                        : "bg-white border-slate-200 shadow-sm"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-bold text-sm">{seg.name}</span>
                        <p className="text-xs text-slate-400">
                          {seg.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {["{{first_name}}", "{{username}}", "{{time}}"].map(
                          (v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() =>
                                setEditingTemplates((prev) => ({
                                  ...prev,
                                  [seg.id]: `${
                                    prev[seg.id] ?? seg.template
                                  } ${v}`,
                                }))
                              }
                              className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 cursor-pointer"
                            >
                              + {v}
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    <textarea
                      rows={3}
                      value={draft}
                      onChange={(e) =>
                        setEditingTemplates((prev) => ({
                          ...prev,
                          [seg.id]: e.target.value,
                        }))
                      }
                      className={`w-full p-3 rounded-xl text-sm border ${
                        darkMode
                          ? "bg-slate-950 border-slate-800 text-slate-100"
                          : "bg-slate-50 border-slate-300 text-slate-900"
                      }`}
                    />

                    <div className="flex justify-end">
                      <button
                        onClick={() => handleSaveTemplate(seg.id)}
                        disabled={savingSegmentId === seg.id}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer disabled:opacity-50"
                      >
                        {savingSegmentId === seg.id
                          ? "Saqlanmoqda..."
                          : "Shablonni Saqlash (Save)"}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </main>

      <AccountSetupModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        session={session}
        onSessionUpdated={fetchState}
        darkMode={darkMode}
      />
    </div>
  );
}
