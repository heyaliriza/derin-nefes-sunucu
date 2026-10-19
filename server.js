// Derin Nefes oda sunucusu: oyunun sitedeki sürümünde "Arkadaşla Oyna" buraya bağlanır.
//
// Her oda (4 harfli kod) en çok ODA_SINIRI bağlantı alır. Her bağlantının küçük bir "durum" nesnesi
// (presence) vardır: oyuncunun görünüşü, hamlesinin şifreli özeti, açılan hamle, bahis... Biri durumunu
// değiştirince odadaki herkese güncel liste gönderilir. Maçın kendisi (hamleler, nefes hesabı) iki
// tarayıcıda aynı kurallarla hesaplanır; sunucu yalnızca taşır, hiçbir şey kaydetmez.
//
// Çalıştırma: npm install && node server.js   (PORT ortam değişkeni; Render gibi hizmetler kendisi verir)
// İsteğe bağlı: IZINLI_ADRESLER=https://kullanici.itch.io,https://html.itch.zone  (boşsa her site bağlanabilir)

"use strict";
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8080;
const ODA_SINIRI = 4;           // bir odadaki en çok bağlantı (oyun 2 oyuncu bekler; fazlası "oda dolu" görür)
const ODA_SAYISI = 5000;        // aynı anda açık en çok oda
const MESAJ_SINIRI = 8192;      // bayt
const DURUM_SINIRI = 4096;      // bir oyuncunun durum nesnesi (JSON) en çok bu kadar
const SANIYEDE_MESAJ = 30;      // bağlantı başına; fazlası sessizce atılır
const izinli = String(process.env.IZINLI_ADRESLER || "").split(",").map((s) => s.trim()).filter(Boolean);

const odalar = new Map();       // oda adı -> Map(kimlik -> soket)
let sonKimlik = 0;

const sunucu = http.createServer((req, res) => {
  // sağlık sayfası: hizmetler bununla sunucunun ayakta olduğunu anlar; sayfa açılınca da uyandırmak için çağrılır
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end("Derin Nefes oda sunucusu çalışıyor. Açık oda: " + odalar.size + "\n");
});

const wss = new WebSocketServer({
  server: sunucu,
  maxPayload: MESAJ_SINIRI,
  verifyClient: (info) => izinli.length === 0 || izinli.includes(String(info.origin || "")),
});

function gonder(ws, nesne) {
  if (ws.readyState === 1) ws.send(JSON.stringify(nesne));
}

function yay(ad) {
  const oda = odalar.get(ad);
  if (!oda) return;
  const kisiler = [...oda.values()].map((s) => ({ peer: s.kimlik, p: s.durum }));
  const mesaj = JSON.stringify({ t: "peers", peers: kisiler });
  for (const s of oda.values()) if (s.readyState === 1) s.send(mesaj);
}

function ayril(ws) {
  const ad = ws.oda;
  if (!ad) return;
  ws.oda = null;
  const oda = odalar.get(ad);
  if (!oda) return;
  oda.delete(ws.kimlik);
  if (oda.size === 0) odalar.delete(ad);
  else yay(ad);
}

function nesneMi(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

wss.on("connection", (ws) => {
  ws.kimlik = "p" + (++sonKimlik);
  ws.oda = null;
  ws.durum = {};
  ws.canli = true;
  ws.pencere = Date.now();
  ws.sayac = 0;
  ws.on("pong", () => { ws.canli = true; });
  gonder(ws, { t: "welcome", id: ws.kimlik });

  ws.on("message", (veri) => {
    const simdi = Date.now();
    if (simdi - ws.pencere > 1000) { ws.pencere = simdi; ws.sayac = 0; }
    if (++ws.sayac > SANIYEDE_MESAJ) return;
    let m;
    try { m = JSON.parse(String(veri)); } catch (e) { return; }
    if (!nesneMi(m)) return;

    if (m.t === "join") {
      const ad = String(m.room || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
      if (!ad) return gonder(ws, { t: "error", code: "bad_room" });
      ayril(ws);
      let oda = odalar.get(ad);
      if (!oda) {
        if (odalar.size >= ODA_SAYISI) return gonder(ws, { t: "error", code: "busy" });
        oda = new Map();
        odalar.set(ad, oda);
      }
      // aynı sekme (bağlantısı kopup) yeniden geldiyse eski bağlantısını odadan çıkar
      const sekme = String(m.cid || "").slice(0, 48);
      if (sekme) {
        for (const s of oda.values()) {
          if (s.sekme === sekme) { oda.delete(s.kimlik); s.oda = null; s.terminate(); }
        }
      }
      if (oda.size >= ODA_SINIRI) return gonder(ws, { t: "error", code: "room_full" });
      ws.sekme = sekme;
      ws.durum = nesneMi(m.p) && JSON.stringify(m.p).length <= DURUM_SINIRI ? m.p : {};
      ws.oda = ad;
      oda.set(ws.kimlik, ws);
      gonder(ws, { t: "joined", id: ws.kimlik });
      yay(ad);
    } else if (m.t === "presence") {
      if (!ws.oda || !nesneMi(m.patch)) return;
      const yeni = Object.assign({}, ws.durum, m.patch);
      for (const k of Object.keys(yeni)) if (yeni[k] === null) delete yeni[k];
      if (JSON.stringify(yeni).length > DURUM_SINIRI) return gonder(ws, { t: "error", code: "too_big" });
      ws.durum = yeni;
      yay(ws.oda);
    } else if (m.t === "leave") {
      ayril(ws);
    }
  });

  ws.on("close", () => ayril(ws));
  ws.on("error", () => ayril(ws));
});

// cevap vermeyen bağlantıları düşür (telefon uyudu, internet gitti...)
const nabiz = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.canli) { ayril(ws); ws.terminate(); continue; }
    ws.canli = false;
    try { ws.ping(); } catch (e) { /* kapanıyor */ }
  }
}, 15000);
wss.on("close", () => clearInterval(nabiz));

sunucu.listen(PORT, () => console.log("Derin Nefes oda sunucusu " + PORT + " numaralı kapıda"));
