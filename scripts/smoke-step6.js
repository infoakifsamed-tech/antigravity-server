/* Adım 6 duman testi: kaybolan mesajlar, ek doğrulama, arama sinyalleşmesi, medya rotaları.
   Kullanım: sunucu çalışırken `node scripts/smoke-step6.js` */
const { io } = require("socket.io-client");

const BASE = process.env.API_URL || "http://localhost:4000";
const suffix = Math.floor(Math.random() * 1e6);

async function http(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} ${extra}`);
  if (!ok) process.exitCode = 1;
};

async function register(name) {
  const r = await http("POST", "/api/auth/register", {
    username: `${name}${suffix}`,
    email: `${name}${suffix}@example.com`,
    password: "Sifre12345",
  });
  if (r.status >= 300) throw new Error(`register ${JSON.stringify(r)}`);
  return r.data;
}

(async () => {
  const a = await register("sa");
  const b = await register("sb");
  const c = await register("sc");
  const ta = a.accessToken;
  const tb = b.accessToken;
  const tc = c.accessToken;
  const uidB = (b.user ?? {}).id;

  const chatId = (await http("POST", "/api/chats/direct", { username: b.user.username }, ta)).data.chatId;
  check("sohbet oluşturuldu", !!chatId);

  const sa = await connect(ta);
  const sb = await connect(tb);
  const sc = await connect(tc);
  await emit(sa, "join_room", { chatId });
  await emit(sb, "join_room", { chatId });

  // --- Kaybolan mesajlar ---
  const bad = await http("PUT", `/api/chats/${chatId}/disappear`, { seconds: 7 }, ta);
  check("geçersiz TTL reddedilir", bad.status === 400, String(bad.status));
  const outsider = await http("PUT", `/api/chats/${chatId}/disappear`, { seconds: 5 }, tc);
  check("üye olmayan TTL değiştiremez", outsider.status === 403 || outsider.status === 404, String(outsider.status));

  const evt = once(sb, "chat_settings");
  const ok = await http("PUT", `/api/chats/${chatId}/disappear`, { seconds: 5 }, ta);
  check("TTL=5 ayarlandı", ok.status === 200, String(ok.status));
  const ev = await evt.catch(() => null);
  check("chat_settings yayınlandı", ev && ev.disappearSeconds === 5);

  const sent = await emit(sa, "send_message", { chatId, body: "kaybolacak", clientId: `c-${suffix}-1` });
  check("mesaj gönderildi, expiresAt var", sent.ok && !!sent.message.expiresAt, JSON.stringify(sent.message?.expiresAt));
  let hist = await http("GET", `/api/chats/${chatId}/messages`, null, tb);
  const list = () => hist.data.messages;
  check("mesaj geçmişte görünür", list().some((m) => m.body === "kaybolacak"));
  await sleep(5500);
  hist = await http("GET", `/api/chats/${chatId}/messages`, null, tb);
  check("süre dolunca geçmişten filtrelenir", !list().some((m) => m.body === "kaybolacak"));

  // --- Ek doğrulama ---
  const foreign = await emit(sa, "send_message", {
    chatId,
    body: "",
    clientId: `c-${suffix}-2`,
    attachments: [{ key: "chats/00000000-0000-4000-8000-000000000000/x-a.png", name: "a.png", mime: "image/png", size: 10 }],
  });
  check("yabancı sohbet anahtarı reddedilir", foreign.ok === false);

  // --- Medya rotaları (S3 yok → 503) ---
  const up = await http("POST", "/api/media/upload-url", { chatId, filename: "a.png", mime: "image/png", size: 10 }, ta);
  check("upload-url S3 yoksa 503 (ya da 200)", up.status === 503 || up.status === 200, String(up.status));
  const noauth = await http("GET", "/api/media/url?key=x");
  check("medya kimliksiz 401", noauth.status === 401, String(noauth.status));

  // --- Arama sinyalleşmesi ---
  const offer = { type: "offer", sdp: "v=0 fake" };
  const answer = { type: "answer", sdp: "v=0 fake" };
  const incoming = once(sb, "call:incoming");
  const inv = await emit(sa, "call:invite", { chatId, kind: "audio", offer });
  check("invite kabul", inv.ok && !!inv.callId, JSON.stringify(inv));
  const inc = await incoming.catch(() => null);
  check("call:incoming alındı", inc && inc.callId === inv.callId && inc.fromUserId === a.user.id);

  const busy = await emit(sa, "call:invite", { chatId, kind: "audio", offer });
  check("meşgulken ikinci arama reddedilir", busy.ok === false);

  const gotAnswer = once(sa, "call:answer");
  const wrong = await emit(sa, "call:answer", { callId: inv.callId, answer });
  check("arayan kendi aramasını yanıtlayamaz", wrong.ok === false);
  const ans = await emit(sb, "call:answer", { callId: inv.callId, answer });
  check("callee yanıtladı", ans.ok === true);
  const ga = await gotAnswer.catch(() => null);
  check("arayan answer aldı", ga && ga.callId === inv.callId);

  const cand = { candidate: "candidate:1 1 UDP 1 1.1.1.1 1 typ host", sdpMid: "0", sdpMLineIndex: 0 };
  const gotIce = once(sa, "call:ice");
  await emit(sb, "call:ice", { callId: inv.callId, candidate: cand });
  const ice = await gotIce.catch(() => null);
  check("ICE aktarıldı", ice && ice.candidate.candidate === cand.candidate);

  const outIce = await emit(sc, "call:ice", { callId: inv.callId, candidate: cand });
  check("katılımcı olmayan ICE gönderemez", outIce.ok === false);

  const ended = once(sb, "call:ended");
  const end = await emit(sa, "call:end", { callId: inv.callId });
  check("arama sonlandırıldı", end.ok === true);
  const en = await ended.catch(() => null);
  check("call:ended karşı tarafa ulaştı", en && en.callId === inv.callId);

  sb.disconnect();
  await sleep(300);
  const off = await emit(sa, "call:invite", { chatId, kind: "video", offer });
  check("çevrimdışı kullanıcı aranamaz", off.ok === false);

  sa.disconnect();
  sc.disconnect();
  process.exit(process.exitCode ?? 0);
})().catch((e) => {
  console.error("HATA", e);
  process.exit(1);
});

