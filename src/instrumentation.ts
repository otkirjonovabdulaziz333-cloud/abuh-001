export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureLiveClientConnected, syncOnlinePresenceScheduler } =
      await import("./lib/mtproto-engine");
    await ensureLiveClientConnected();
    syncOnlinePresenceScheduler();
  }
}
