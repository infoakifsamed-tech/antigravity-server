/* GerÃ§ek S3/R2 testi: presigned PUT ile yÃ¼kle, presigned GET ile indir, iÃ§eriÄŸi doÄŸrula, yabancÄ±yÄ± reddet.
   KullanÄ±m: sunucu Ã§alÄ±ÅŸÄ±rken `node scripts/smoke-media.js` */
const BASE = process.env.API_URL || "http://localhost:4000";
const suffix = Math.floor(Math.random() * 1e6);
const check = (n, ok, x = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${n} ${x}`);
  if (!ok) process.exitCode = 1;
};
async function http(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const reg = async (n) =>
  (await http("POST", "/api/auth/register", { username: `${n}${suffix}`, email: `${n}${suffix}@example.com`, password: "Sifre12345" })).data;

(async () => {
  const a = await reg("ma");
  const b = await reg("mb");
  const c = await reg("mc");
  const { chatId } = (await http("POST", "/api/chats/direct", { username: b.user.username }, a.accessToken)).data;
  const payload = Buffer.from("antigravity-media-test-" + suffix);
  const up = await http("POST", "/api/media/upload-url", { chatId, filename: "test.txt", mime: "text/plain", size: payload.length }, a.accessToken);
  check("upload-url alÄ±ndÄ±", up.status === 200, JSON.stringify(up.data).slice(0, 120));
  const put = await fetch(up.data.uploadUrl ?? up.data.url, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: payload });
  check("R2'ye yÃ¼klendi", put.ok, String(put.status));
  const key = up.data.key;
  const dl = await http("GET", `/api/media/url?key=${encodeURIComponent(key)}`, null, b.accessToken);
  check("Ã¼ye indirme URL'si aldÄ±", dl.status === 200, String(dl.status));
  const got = await fetch(dl.data.url);
  check("iÃ§erik aynÄ±", (await got.text()) === payload.toString());
  const out = await http("GET", `/api/media/url?key=${encodeURIComponent(key)}`, null, c.accessToken);
  check("Ã¼ye olmayan reddedildi", out.status === 403 || out.status === 404, String(out.status));
})().catch((e) => {
  console.error("HATA", e);
  process.exit(1);
});

