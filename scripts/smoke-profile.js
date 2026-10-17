/* Profil ve görünmez mod duman testi. Kullanım: sunucu çalışırken `node scripts/smoke-profile.js` */
const { io } = require("socket.io-client");
const BASE = process.env.API_URL || "http://localhost:4000";
const n = Math.floor(Math.random() * 1e6);

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} ${extra}`);
  if (!ok) process.exitCode = 1;
};
const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ["websocket"], auth: { token } });
    s.on("server:ready", () => resolve(s));
    s.on("connect_error", reject);
  });
const emit = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));

(async () => {
  const a = (await call("POST", "/api/auth/register", { username: `pa${n}`, email: `pa${n}@example.com`, password: "Sifre12345" })).data;
  const b = (await call("POST", "/api/auth/register", { username: `pb${n}`, email: `pb${n}@example.com`, password: "Sifre12345" })).data;

  let r = await call("PATCH", "/api/users/me", { displayName: "  Yeni Ad  " }, a.accessToken);
  check("displayName güncellendi (boşluklar kırpıldı)", r.status === 200 && r.data.user.display_name === "Yeni Ad");

  r = await call("PATCH", "/api/users/me", {}, a.accessToken);
  check("Boş istek reddedildi", r.status === 400, r.data.error);

  r = await call("PATCH", "/api/users/me", { settings: { admin: true } }, a.accessToken);
  check("Bilinmeyen ayar reddedildi", r.status === 400);

  r = await call("PATCH", "/api/users/me", { displayName: "x" }, null);
  check("Tokensız reddedildi", r.status === 401);

  r = await call("PATCH", "/api/users/me", { settings: { invisibleMode: true } }, b.accessToken);
  check("invisibleMode kaydedildi, öncekiler korundu", r.status === 200 && r.data.user.settings.invisibleMode === true && r.data.user.settings.font === "inter");

  const { chatId } = (await call("POST", "/api/chats/direct", { username: b.user.username }, a.accessToken)).data;
  const sa = await connect(a.accessToken);
  const sb = await connect(b.accessToken);
  const sent = await emit(sa, "send_message", { chatId, body: "gizli oku", clientId: `cid-${n}-aaaa` });

  let leaked = false;
  sa.on("seen", () => (leaked = true));
  await emit(sb, "seen", { chatId, messageIds: [sent.message.id] });
  await new Promise((r2) => setTimeout(r2, 700));
  check("Görünmez modda 'seen' iletilmedi", leaked === false);

  const hist = (await call("GET", `/api/chats/${chatId}/messages`, null, a.accessToken)).data;
  check("Görünmez modda okundu kaydı yok", !hist.messages[0].readBy.includes(b.user.id));

  await call("PATCH", "/api/users/me", { settings: { invisibleMode: false } }, b.accessToken);
  const got = new Promise((res) => sa.once("seen", res));
  await emit(sb, "seen", { chatId, messageIds: [sent.message.id] });
  const ev = await Promise.race([got, new Promise((res) => setTimeout(() => res(null), 3000))]);
  check("Mod kapanınca (yeniden bağlanmadan) 'seen' iletildi", !!ev);

  sa.disconnect();
  sb.disconnect();
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
