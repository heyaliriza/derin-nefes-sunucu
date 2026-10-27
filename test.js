// Oda sunucusu protokol sınaması. Önce sunucuyu başlat: YONETICI_ANAHTARI=deneme SKOR_IP_SINIRI=1000 PORT=8099 node server.js ;
// sonra: YONETICI_ANAHTARI=deneme node test.js  (anahtar verilmezse yönetim sayfası denetimleri atlanır)
const WebSocket = require("ws");
const crypto = require("crypto");
const PORT = process.env.PORT || 8099;
const URL = "ws://127.0.0.1:" + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function client(name, cid) {
  const ws = new WebSocket(URL);
  const c = { ws, name, id: null, peers: [], errors: [] };
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.t === "welcome" || m.t === "joined") c.id = m.id;
    if (m.t === "peers") c.peers = m.peers;
    if (m.t === "error") c.errors.push(m.code);
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.open = new Promise((r) => ws.on("open", r));
  c.cid = cid;
  return c;
}
let fails = 0;
const check = (ok, what) => { console.log((ok ? "  ok   " : "  HATA ") + what); if (!ok) fails++; };
(async () => {
  const a = client("A", "tabA"), b = client("B", "tabB");
  await a.open; await b.open;
  a.send({ t: "join", room: "dn-ABCD", cid: "tabA", p: { app: "dn", role: "host" } });
  await wait(100);
  b.send({ t: "join", room: "dn-abcd", cid: "tabB", p: { app: "dn", role: "guest" } });
  await wait(150);
  check(a.peers.length === 2 && b.peers.length === 2, "iki oyuncu aynı odada birbirini görür");
  b.send({ t: "presence", patch: { c: "hash123", rv: null } });
  await wait(100);
  const bInA = a.peers.find((p) => p.peer === b.id);
  check(bInA && bInA.p.c === "hash123" && bInA.p.role === "guest", "durum güncellemesi birleşir ve karşıya ulaşır");
  b.send({ t: "presence", patch: { c: null } });
  await wait(100);
  check(!("c" in a.peers.find((p) => p.peer === b.id).p), "null alanı siler");
  // aynı sekme yeniden bağlanır: eski bağlantı odadan düşer
  const b2 = client("B2", "tabB"); await b2.open;
  b2.send({ t: "join", room: "dn-abcd", cid: "tabB", p: { app: "dn", role: "guest", again: 1 } });
  await wait(200);
  check(a.peers.length === 2 && a.peers.some((p) => p.peer === b2.id) && !a.peers.some((p) => p.peer === b.id), "yeniden bağlanan sekme eskisinin yerini alır");
  // oda sınırı (4)
  const c = client("C", "tabC"), d = client("D", "tabD"), e = client("E", "tabE");
  await c.open; await d.open; await e.open;
  for (const x of [c, d, e]) x.send({ t: "join", room: "dn-abcd", cid: x.cid, p: {} });
  await wait(200);
  check(e.errors.includes("room_full") && a.peers.length === 4, "beşinci kişi 'oda dolu' alır");
  // bozuk girdiler sunucuyu düşürmez
  a.ws.send("{bozuk json"); a.send([1, 2]); a.send({ t: "presence", patch: "x" }); a.send({ t: "join", room: "!!!" });
  a.send({ t: "presence", patch: { big: "x".repeat(5000) } });
  await wait(150);
  check(a.errors.includes("bad_room") && a.errors.includes("too_big"), "bozuk oda adı ve büyük durum reddedilir");
  // ayrılınca liste güncellenir
  for (const x of [c, d]) x.send({ t: "leave" });
  b2.ws.close();
  await wait(200);
  const a2 = client("A2", "tabA2"); await a2.open;
  a2.send({ t: "join", room: "dn-zzzz", cid: "tabA2", p: {} });
  await wait(100);
  check(a2.peers.length === 1, "başka oda ayrı");
  const res = await fetch("http://127.0.0.1:" + PORT + "/");
  check(res.ok && (await res.text()).includes("çalışıyor"), "sağlık sayfası yanıt verir");
  for (const [yol, aranan] of [["/gizlilik", "Gizlilik Politikası"], ["/privacy", "Privacy Policy"]]) {
    const r = await fetch("http://127.0.0.1:" + PORT + yol);
    check(r.ok && (r.headers.get("content-type") || "").startsWith("text/html") && (await r.text()).includes(aranan), yol + " gizlilik sayfası açılır");
  }
  // liderlik tablosu
  const base = "http://127.0.0.1:" + PORT + "/skor";
  const gonder = (o) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) }).then(async (r) => [r.status, await r.json()]);
  const kim = (n) => ("a1b2c3d4e5f6a7b8" + n).slice(0, 18);
  const tur = Date.now() % 1000;   // her çalıştırmada farklı kimlikler (dosya deposu kalıcı olabilir)
  const k1 = kim(String(tur).padStart(2, "0")), k2 = kim("f" + (tur % 10)), k3 = "ee" + kim("3").slice(2);
  let [st, js] = await gonder({ board: "speedrun", id: k1, name: [3, 5, 42], value: 500000 });
  check(st === 200 && js.ok, "speedrun skoru kaydedildi");
  [st, js] = await gonder({ board: "speedrun", id: k1, name: [3, 5, 42], value: 700000 });
  check(st === 200 && js.me && js.me.deger === 500000, "daha kötü süre en iyiyi bozmaz");
  [st, js] = await gonder({ board: "speedrun", id: k1, name: [4, 6, 7], value: 400000 });
  check(st === 200 && js.me && js.me.deger === 400000, "daha iyi süre kaydı günceller");
  await gonder({ board: "speedrun", id: k2, name: [1, 1, 1], value: 300000 });
  let g = await (await fetch(base + "?board=speedrun&id=" + k1)).json();
  const i1 = g.rows.findIndex((r) => r.me), i2 = g.rows.findIndex((r) => r.value === 300000);
  check(i1 >= 0 && i2 >= 0 && i2 < i1 && g.rows[i1].name.join() === "4,6,7", "küçük süre üstte; ad güncellendi; 'ben' işaretli");
  check(g.rows.every((r) => !("id" in r)), "başkalarının kimliği listede gönderilmez");
  await gonder({ board: "endless", id: k3, name: [0, 0, 0], value: 5 });
  await gonder({ board: "endless", id: k3, name: [0, 0, 0], value: 9 });
  g = await (await fetch(base + "?board=endless&id=" + k3)).json();
  check(g.me && g.me.deger === 9, "sonsuzda büyük değer iyidir");
  const kotu = [
    [{ board: "yok", id: k1, name: [0, 0, 0], value: 5 }, "bad_board"],
    [{ board: "speedrun", id: "XYZ", name: [0, 0, 0], value: 500000 }, "bad_id"],
    [{ board: "speedrun", id: k1, name: [0, 0, 999], value: 500000 }, "bad_name"],
    [{ board: "speedrun", id: k1, name: ["a", 0, 0], value: 500000 }, "bad_name"],
    [{ board: "speedrun", id: k1, name: [0, 0, 0], value: 10 }, "bad_value"],
  ];
  let red = 0;
  for (const [o, e] of kotu) { const [s2, j2] = await gonder(o); if (s2 === 400 && j2.error === e) red++; }
  check(red === kotu.length, "bozuk skorlar reddedilir (tablo, kimlik, ad, değer)");
  // oyuncunun yazdığı ad
  const yeni = () => crypto.randomBytes(12).toString("hex");
  const satirim = async (tablo, id) => (await (await fetch(base + "?board=" + tablo + "&id=" + id)).json()).rows.find((r) => r.me);
  const hedef = yeni();
  [st, js] = await gonder({ board: "speedrun", id: hedef, name: "  Deniz   Kızı ", gen: [2, 3, 4], value: 600000 });
  let r = await satirim("speedrun", hedef);
  check(st === 200 && !js.name_rejected && r && r.name === "Deniz Kızı" && /^[a-f0-9]{16}$/.test(r.ref), "yazılan ad kaydedilir, boşlukları düzeltilir");
  const reddedilen = [["ab", "bad_name"], ["Çok Uzun Bir Ad Bu Olur", "bad_name"], ["Привет", "bad_name"], ["abc😀", "bad_name"], ["1234", "bad_name"],
    ["Orospu Çocuğu", "rude_name"], ["0r0spu", "rude_name"], ["o r o s p u", "rude_name"], ["FUUUCK", "rude_name"], ["a.m.k", "rude_name"], ["Sik", "rude_name"]];
  let dogru = 0;
  for (const [ad, kod] of reddedilen) {
    const kim2 = yeni();
    const [s3, j3] = await gonder({ board: "endless", id: kim2, name: ad, gen: [1, 2, 3], value: 3 });
    const r3 = await satirim("endless", kim2);
    if (s3 === 200 && j3.name_rejected === kod && r3 && Array.isArray(r3.name)) dogru++;
    else console.log("    beklenmedik:", ad, s3, j3, r3 && r3.name);
  }
  check(dogru === reddedilen.length, "uygunsuz adlar reddedilir, skor zarla üretilen adla kaydedilir");
  let temiz = 0;
  const uygun = ["Kayarak Gelen", "Musiki Sever", "Sıkı Dostlar", "Therapist", "Nazilli 09", "Scunthorpe", "Fukuoka", "Çağrı_34", "Zoë-Ñandú"];
  for (const ad of uygun) {
    const [s3, j3] = await gonder({ board: "endless", id: yeni(), name: ad, gen: [1, 2, 3], value: 2 });
    if (s3 === 200 && !j3.name_rejected) temiz++;
    else console.log("    yanlış red:", ad, j3);
  }
  check(temiz === uygun.length, "zararsız adlar süzgece takılmaz");
  [st, js] = await gonder({ board: "speedrun", id: yeni(), name: "Deniz", value: 600000 });
  check(st === 400 && js.error === "bad_name", "yazılan adla birlikte zarla üretilen ad da gelmeli");
  // bildirim: iki farklı oyuncu bildirince ad gizlenir
  const bildir = (o) => fetch(base + "/bildir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) }).then(async (x) => [x.status, await x.json()]);
  const hRef = (await satirim("speedrun", hedef)).ref;
  const bil1 = yeni(), bil2 = yeni();
  const [, y1] = await bildir({ board: "speedrun", id: bil1, ref: hRef });
  const [, y1b] = await bildir({ board: "speedrun", id: bil1, ref: hRef });
  r = await satirim("speedrun", hedef);
  check(y1.ok && !y1.hidden && !y1b.hidden && r.name === "Deniz Kızı", "tek kişinin bildirimi (iki kez de olsa) adı gizlemez");
  const [, y2] = await bildir({ board: "speedrun", id: bil2, ref: hRef });
  r = await satirim("speedrun", hedef);
  check(y2.ok && y2.hidden && Array.isArray(r.name) && r.name.join() === "2,3,4", "iki kişi bildirince ad gizlenir, zarla üretilen ad görünür");
  [st, js] = await gonder({ board: "speedrun", id: hedef, name: "Deniz Kızı", gen: [2, 3, 4], value: 600000 });
  check(js.name_rejected === "name_hidden", "gizlenen ad yeniden gönderilince kabul edilmez");
  [st, js] = await gonder({ board: "speedrun", id: hedef, name: "Mavi Deniz", gen: [2, 3, 4], value: 600000 });
  check(!js.name_rejected && (await satirim("speedrun", hedef)).name === "Mavi Deniz", "oyuncu yeni bir ad yazabilir");
  const [sk, jk] = await bildir({ board: "speedrun", id: hedef, ref: hRef });
  const [sb, jb] = await bildir({ board: "speedrun", id: bil1, ref: "zz" });
  const [sy] = await bildir({ board: "speedrun", id: bil1, ref: "0123456789abcdef" });
  check(sk === 400 && jk.error === "self" && sb === 400 && jb.error === "bad_ref" && sy === 404, "kendini bildirme, bozuk ve bilinmeyen iz reddedilir");
  const anahtar = process.env.YONETICI_ANAHTARI || "";
  const yon = base + "/yonet";
  check((await fetch(yon)).status === 404 && (await fetch(yon + "?anahtar=yanlis")).status === 404, "yönetim sayfası anahtarsız açılmaz");
  if (anahtar) {
    let sayfa = await (await fetch(yon + "?anahtar=" + encodeURIComponent(anahtar))).text();
    check(sayfa.includes("Deniz Kızı") && sayfa.includes("Mavi Deniz"), "yönetim sayfası bildirilen ve yazılan adları gösterir");
    const form = (islem) => fetch(yon, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ anahtar, id: hedef, ad: "Mavi Deniz", islem }).toString() }).then((x) => x.text());
    sayfa = await form("kilitle");
    r = await satirim("speedrun", hedef);
    [st, js] = await gonder({ board: "speedrun", id: hedef, name: "Başka Ad", gen: [2, 3, 4], value: 600000 });
    check(sayfa.includes("Kilidi aç") && sayfa.includes("Mavi Deniz") && Array.isArray(r.name) && js.name_rejected === "name_locked",
      "yönetici adı gizleyip kilitler, oyuncu ad yazamaz");
    await form("kilit_ac");
    [st, js] = await gonder({ board: "speedrun", id: hedef, name: "Başka Ad", gen: [2, 3, 4], value: 600000 });
    check(!js.name_rejected, "kilit açılınca ad yazılabilir");
  } else {
    console.log("  (YONETICI_ANAHTARI verilmedi: yönetim sayfası denetimleri atlandı)");
  }
  const sil = await (await fetch(base + "?id=" + k1, { method: "DELETE" })).json();
  g = await (await fetch(base + "?board=speedrun&id=" + k1)).json();
  check(sil.ok && sil.deleted >= 1 && g.me === null && !g.rows.some((r) => r.me), "oyuncu kendi skorlarını silebilir");
  const pre = await fetch(base, { method: "OPTIONS" });
  check(pre.headers.get("access-control-allow-origin") === "*", "tarayıcı sürümü için CORS açık");
  console.log(fails ? "SUNUCU HATA" : "SUNUCU TAMAM");
  process.exit(0);
})();
