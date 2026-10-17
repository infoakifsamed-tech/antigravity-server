/* Gerçek zamanlı mesajlaşma duman testi: iki kullanıcı oluşturur, sohbet açar, mesaj/yazıyor/okundu/presence akışını doğrular.
   Kullanım: sunucu çalışırken `node scripts/smoke-realtime.js` */
const { io } = require("socket.io-client");

const BASE = process.env.API_URL || "http://localhost:4000";
const suffix = Math.floor(Math.random() * 1e6);

async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ["websocket"], auth: { token } });
    s.on("server:ready", () => resolve(s));
    s.on("connect_error", reject);
  });

const once = (s, ev, ms = 4000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`zaman aşımı: ${ev}`)), ms);
    s.once(ev, (d) => {
      clearTimeout(t);
      resolve(d);
    });
  });

const emit = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, resolve));
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} ${extra}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  const a = await post("/api/auth/register", { username: `smokea${suffix}`, email: `a${suffix}@example.com`, password: "Sifre12345" });
  const b = await post("/api/auth/register", { username: `smokeb${suffix}`, email: `b${suffix}@example.com`, password: "Sifre12345" });

  const sa = await connect(a.accessToken);
  const { chatId } = await post("/api/chats/direct", { username: b.user.username }, a.accessToken);
  const sb = await connect(b.accessToken); // sohbet oluşturulduktan sonra bağlanır; odaya otomatik katılmalı
  check("B bağlandı ve sohbet odasına katıldı", sb.connected);

  const noAuth = await new Promise((r) => {
    const s = io(BASE, { transports: ["websocket"], auth: { token: "gecersiz" }, reconnection: false });
    s.on("connect_error", (e) => { s.close(); r(e.message); });
  });
  check("Geçersiz token reddedildi", noAuth === "unauthorized", noAuth);

  const recv = once(sb, "receive_message");
  const ack = await emit(sa, "send_message", { chatId, body: "Merhaba!", clientId: `cid-${suffix}-1` });
  check("send_message ack", ack.ok === true && ack.message.body === "Merhaba!");
  const got = await recv;
  check("B receive_message aldı", got.body === "Merhaba!" && got.senderId === a.user.id);

  const dup = await emit(sa, "send_message", { chatId, body: "Merhaba!", clientId: `cid-${suffix}-1` });
  check("Aynı clientId çift kaydedilmedi", dup.ok && dup.message.id === ack.message.id);

  const typing = once(sa, "typing");
  await emit(sb, "typing", { chatId, isTyping: true });
  const t = await typing;
  check("typing iletildi", t.isTyping === true && t.userId === b.user.id);

  const seen = once(sa, "seen");
  await emit(sb, "seen", { chatId, messageIds: [got.id] });
  const s = await seen;
  check("seen iletildi", s.messageIds.includes(got.id) && s.userId === b.user.id);

  const hist = await (await fetch(`${BASE}/api/chats/${chatId}/messages`, { headers: { Authorization: `Bearer ${b.accessToken}` } })).json();
  check("Geçmiş getirildi, okundu işaretli", hist.messages.length === 1 && hist.messages[0].readBy.includes(b.user.id));

  const list = await (await fetch(`${BASE}/api/chats`, { headers: { Authorization: `Bearer ${a.accessToken}` } })).json();
  check("Sohbet listesi son mesajla geldi", list.chats[0]?.lastMessage?.body === "Merhaba!");

  const pres = await emit(sa, "presence_get", { userIds: [b.user.id] });
  check("presence: B çevrimiçi", pres.ok && pres.presence[b.user.id].online === true);

  const off = once(sa, "presence");
  sb.disconnect();
  const o = await off;
  check("presence: B çevrimdışı + son görülme", o.userId === b.user.id && o.online === false && !!o.lastSeen);

  const outsider = await post("/api/auth/register", { username: `smokec${suffix}`, email: `c${suffix}@example.com`, password: "Sifre12345" });
  const sc = await connect(outsider.accessToken);
  const denied = await emit(sc, "send_message", { chatId, body: "sızma", clientId: `cid-${suffix}-x1` });
  check("Üye olmayan mesaj atamadı", denied.ok === false, denied.error);

  sa.disconnect();
  sc.disconnect();
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
