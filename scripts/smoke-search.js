/* Kullanıcı arama uç noktası testi. Kullanım: sunucu çalışırken `node scripts/smoke-search.js` */
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
  (await http("POST", "/api/auth/register", { username: n, email: `${n}@example.com`, password: "Sifre12345" })).data;

(async () => {
  const a = await reg(`srcha${suffix}`);
  await reg(`srchb${suffix}`);
  const r = await http("GET", `/api/users/search?q=${encodeURIComponent("@srchb" + suffix)}`, null, a.accessToken);
  check("önekle bulundu (@ kabul)", r.status === 200 && r.data.users.some((u) => u.username === `srchb${suffix}`), String(r.status));
  check("e-posta sızdırılmıyor", r.status === 200 && r.data.users.every((u) => !("email" in u)));
  const self = await http("GET", `/api/users/search?q=srcha${suffix}`, null, a.accessToken);
  check("kendini döndürmüyor", self.data.users.length === 0);
  const wild = await http("GET", `/api/users/search?q=${encodeURIComponent("%")}`, null, a.accessToken);
  check("% joker olarak yorumlanmıyor", wild.status === 200 && wild.data.users.length === 0, String(wild.data.users?.length));
  const empty = await http("GET", `/api/users/search?q=`, null, a.accessToken);
  check("boş sorgu 400", empty.status === 400, String(empty.status));
  const noauth = await http("GET", `/api/users/search?q=a`);
  check("kimliksiz 401", noauth.status === 401, String(noauth.status));
})().catch((e) => {
  console.error("HATA", e);
  process.exit(1);
});
