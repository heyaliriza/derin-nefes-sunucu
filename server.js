// Derin Nefes oda sunucusu: oyunun sitedeki sürümünde ve Android uygulamasında "Arkadaşla Oyna" buraya bağlanır.
//
// Her oda (4 harfli kod) en çok ODA_SINIRI bağlantı alır. Her bağlantının küçük bir "durum" nesnesi
// (presence) vardır: oyuncunun görünüşü, hamlesinin şifreli özeti, açılan hamle, bahis... Biri durumunu
// değiştirince odadaki herkese güncel liste gönderilir. Maçın kendisi (hamleler, nefes hesabı) iki
// tarayıcıda aynı kurallarla hesaplanır; sunucu yalnızca taşır, hiçbir şey kaydetmez.
//
// Çalıştırma: npm install && node server.js   (PORT ortam değişkeni; Render gibi hizmetler kendisi verir)
// İsteğe bağlı: IZINLI_ADRESLER=https://kullanici.itch.io,https://html.itch.zone  (boşsa her site bağlanabilir;
// uygulama her durumda bağlanır)
// /gizlilik ve /privacy: aynı klasördeki gizlilik.html ve privacy.html (Google Play için gizlilik politikası)
// /skor: liderlik tablosu (Speedrun, Souls, Sonsuz). DATABASE_URL (Postgres, ör. Neon) verilirse skorlar kalıcıdır;
// verilmezse sunucunun yanındaki skorlar.json'da tutulur (Render'ın ücretsiz planında sunucu uyuyup kalkınca silinir).
// /skor/bildir: oyuncuların yazdığı uygunsuz adları bildirme. /skor/yonet?anahtar=...: adları gözden geçirme sayfası
// (YONETICI_ANAHTARI ortam değişkeni verilirse açılır).

"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

// Google Play'in istediği gizlilik politikası: aynı klasördeki gizlilik.html / privacy.html (varsa) sunulur
const sayfalar = { "/gizlilik": "gizlilik.html", "/gizlilik.html": "gizlilik.html", "/privacy": "privacy.html", "/privacy.html": "privacy.html" };

// ------------------------------------------------------------------ liderlik tablosu
// Bir kayıt: oyuncunun rastgele kimliği (oyun kurulunca üretilir), adı ve değeri. Her oyuncunun her tabloda yalnızca
// en iyi değeri tutulur. Ad iki türlüdür: zarla üretilen ad (hazır sözcük listelerinden üç sayı: sıfat, deniz canlısı,
// 0-99 arası sayı; her oyuncuya kendi dilinde gösterilir) ya da oyuncunun yazdığı ad (3-16 karakter: Latin harfleri,
// rakam, boşluk, . _ -; kötü sözler süzülür). Yazılan ad bildirilip gizlenince zarla üretilen ad görünür; bu yüzden o
// da her zaman saklanır.
const TABLOLAR = {
  speedrun: { kucuk: true, min: 90000, max: 4 * 3600 * 1000 },   // ms; 1. bölüm 90 saniyeden kısa sürmez
  souls: { kucuk: true, min: 0, max: 100000 },                    // 1. bölümü bitirene kadar ölüm sayısı
  endless: { kucuk: false, min: 1, max: 100000 },                 // Sonsuz Mod'da bayıltılan rakip
};
const AD_SINIR = [64, 64, 100];       // sıfat, canlı ve sayı listelerinin boyu (oyundakiyle aynı ya da büyük)
const LISTE_BOYU = 50;
const IP_PENCERE = 10 * 60 * 1000;    // ms
const IP_SINIR = Number(process.env.SKOR_IP_SINIRI) || 40;   // bir IP'den bu pencerede en çok gönderim / bildirim
const ipSayac = new Map();
const BILDIRIM_ESIGI = 2;             // bir adı bu kadar farklı oyuncu bildirirse ad gizlenir
// /skor/yonet sayfasının anahtarı; verilmezse yönetim sayfası kapalıdır
const YONETICI_ANAHTARI = String(process.env.YONETICI_ANAHTARI || "");

// ---- oyuncunun yazdığı ad: oyundaki scripts/nick.gd ile aynı kurallar ve aynı listeler
const AD_EN_AZ = 3;
const AD_EN_COK = 16;
// --- oyunla aynı (scripts/nick.gd): harf eşleme, tam sözcük ve parça listeleri
const HARF_ESLE = "àáâãäåāăą:a çćĉċč:c ďđð:d èéêëēĕėęě:e ĝğġģ:g ĥħ:h ìíîïĩīĭįı:i ĵ:j ķĸ:k ĺļľŀł:l ñńņňŉŋ:n òóôõöøōŏő:o ŕŗř:r śŝşšſ:s ţťŧ:t ùúûüũūŭůűų:u ŵ:w ýÿŷ:y źżž:z 0:o 1:i 3:e 4:a 5:s 7:t 8:b";
const KOTU_TAM = "amk amq aq amina sik sikik sikim sikis sokam got yarak yarrak dalyarak tasak pic kaltak ibne pust gavat anani ananin bok godos kevase fahise surtuk fck cunt dick cock pussy slut fag nigger nigga asshole bastard sex rape rapist nazi retard admin moderator mod yonetici";
const KOTU_PARCA = "orospu orosbu pezevenk gotveren yavsak serefsiz aminako amcik siktir sikerim sikeyim kahpe fuck shit bitch whore faggot porn hitler pedofil pedophil";
// --- oyunla aynı son
const esle = new Map();
for (const grup of HARF_ESLE.split(" ").filter(Boolean)) {
  const [harfler, yerine] = grup.split(":");
  for (const h of harfler) esle.set(h, yerine);
}
const tekle = (s) => s.replace(/(.)\1+/gu, "$1");   // "fuuuck" -> "fuck"
const kotuTam = new Set(KOTU_TAM.split(" ").filter(Boolean).map(tekle));
const kotuParca = KOTU_PARCA.split(" ").filter(Boolean).map(tekle);
const HARF = "A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u017F";
const AD_KARAKTER = new RegExp("^[" + HARF + "0-9 ._\\-]+$", "u");
const AD_HARF = new RegExp("[" + HARF + "]", "u");

function adTemizle(s) {
  return String(s).replace(/[\t\n\v\f\r ]+/g, " ").trim();
}

// küçük harf, aksansız, rakamlar harfe (0->o, 1->i...): "Or0Spu" ile "orospu" aynı görünür
function adKatla(s) {
  let cikti = "";
  for (const h of s.replace(/İ/g, "i").replace(/I/g, "i").toLowerCase()) cikti += esle.has(h) ? esle.get(h) : h;
  return cikti;
}

function kabaMi(s) {
  const parcalar = adKatla(s).split(/[ ._-]+/).filter(Boolean).map(tekle);
  const butun = tekle(parcalar.join(""));
  if (kotuTam.has(butun) || parcalar.some((p) => kotuTam.has(p))) return true;
  return kotuParca.some((w) => butun.includes(w));
}

// yazılan ad uygunsa null, değilse hata kodu
function adHatasi(s) {
  if (typeof s !== "string") return "bad_name";
  s = adTemizle(s);
  const n = [...s].length;
  if (n < AD_EN_AZ || n > AD_EN_COK || !AD_KARAKTER.test(s) || !AD_HARF.test(s)) return "bad_name";
  return kabaMi(s) ? "rude_name" : null;
}

function gecerliUclu(ad) {
  return Array.isArray(ad) && ad.length === 3 && ad.every((x, i) => Number.isInteger(x) && x >= 0 && x < AD_SINIR[i]);
}

// tabloda başkalarının kimliği gösterilmez; bildirim için satırın kimliğinden türetilen kısa bir iz gönderilir
const iz = (id) => crypto.createHash("sha256").update("dn:" + id).digest("hex").slice(0, 16);

function skorDepo() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const havuz = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "0" ? false : true, max: 3 });
    // Neon gibi hizmetler boşta kalan bağlantıyı kapatır: dinlenmeyen havuz hatası sunucuyu düşürmesin.
    havuz.on("error", (e) => console.error("veritabanı bağlantısı koptu:", e.message));
    let kurulum = null;   // tablolar kurulamadıysa sonraki istekte yeniden denenir
    const hazir = () => (kurulum ||= havuz.query(
      "CREATE TABLE IF NOT EXISTS skorlar (tablo text NOT NULL, id text NOT NULL, a int NOT NULL, b int NOT NULL, n int NOT NULL, deger bigint NOT NULL, zaman bigint NOT NULL, PRIMARY KEY (tablo, id));" +
      "ALTER TABLE skorlar ADD COLUMN IF NOT EXISTS ozel text;" +
      "CREATE TABLE IF NOT EXISTS bildirimler (hedef text NOT NULL, bildiren text NOT NULL, ad text NOT NULL, zaman bigint NOT NULL, PRIMARY KEY (hedef, bildiren, ad));" +
      "CREATE TABLE IF NOT EXISTS ad_kilit (id text PRIMARY KEY, zaman bigint NOT NULL, ad text NOT NULL);")
      .catch((e) => { kurulum = null; throw e; }));
    hazir().catch((e) => console.error("veritabanına bağlanılamadı:", e.message));
    const sorgu = async (q, p) => { await hazir(); return havuz.query(q, p); };
    return {
      ad: "postgres",
      async yaz(tablo, k) {
        const iyi = TABLOLAR[tablo].kucuk ? "LEAST" : "GREATEST";
        await sorgu(
          "INSERT INTO skorlar (tablo, id, a, b, n, ozel, deger, zaman) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) " +
          "ON CONFLICT (tablo, id) DO UPDATE SET a = EXCLUDED.a, b = EXCLUDED.b, n = EXCLUDED.n, ozel = EXCLUDED.ozel, " +
          "zaman = CASE WHEN " + iyi + "(skorlar.deger, EXCLUDED.deger) <> skorlar.deger THEN EXCLUDED.zaman ELSE skorlar.zaman END, " +
          "deger = " + iyi + "(skorlar.deger, EXCLUDED.deger)",
          [tablo, k.id, k.ad[0], k.ad[1], k.ad[2], k.ozel, k.deger, k.zaman]);
      },
      async oku(tablo, id) {
        const yon = TABLOLAR[tablo].kucuk ? "ASC" : "DESC";
        const ust = await sorgu("SELECT id, a, b, n, ozel, deger FROM skorlar WHERE tablo = $1 ORDER BY deger " + yon + ", zaman ASC LIMIT " + LISTE_BOYU, [tablo]);
        let ben = null;
        if (id) {
          const r = await sorgu("SELECT deger, zaman FROM skorlar WHERE tablo = $1 AND id = $2", [tablo, id]);
          if (r.rows.length) {
            const d = Number(r.rows[0].deger);
            const op = TABLOLAR[tablo].kucuk ? "<" : ">";
            const s = await sorgu("SELECT count(*) AS c FROM skorlar WHERE tablo = $1 AND (deger " + op + " $2 OR (deger = $2 AND zaman < $3))", [tablo, d, r.rows[0].zaman]);
            ben = { sira: Number(s.rows[0].c) + 1, deger: d };
          }
        }
        const say = await sorgu("SELECT count(*) AS c FROM skorlar WHERE tablo = $1", [tablo]);
        return { satirlar: ust.rows.map((r) => ({ id: r.id, ad: [r.a, r.b, r.n], ozel: r.ozel, deger: Number(r.deger) })), ben, toplam: Number(say.rows[0].c) };
      },
      async sil(id) {
        const r = await sorgu("DELETE FROM skorlar WHERE id = $1", [id]);
        await sorgu("DELETE FROM bildirimler WHERE hedef = $1 OR bildiren = $1", [id]);
        return r.rowCount;
      },
      async bildir(hedef, bildiren, ad, zaman) {
        await sorgu("INSERT INTO bildirimler (hedef, bildiren, ad, zaman) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [hedef, bildiren, ad, zaman]);
        return this.bildirimSayisi(hedef, ad);
      },
      async bildirimSayisi(hedef, ad) {
        const r = await sorgu("SELECT count(*) AS c FROM bildirimler WHERE hedef = $1 AND ad = $2", [hedef, ad]);
        return Number(r.rows[0].c);
      },
      async ozelGizle(id) { await sorgu("UPDATE skorlar SET ozel = NULL WHERE id = $1", [id]); },
      async kilitli(id) { return (await sorgu("SELECT 1 FROM ad_kilit WHERE id = $1", [id])).rows.length > 0; },
      async kilitle(id, zaman, ad) {
        await sorgu("INSERT INTO ad_kilit (id, zaman, ad) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [id, zaman, ad]);
        await this.ozelGizle(id);
      },
      async kilitAc(id) { await sorgu("DELETE FROM ad_kilit WHERE id = $1", [id]); },
      async bildirimSil(id) { await sorgu("DELETE FROM bildirimler WHERE hedef = $1", [id]); },
      async yonetimListesi() {
        const b = await sorgu("SELECT hedef AS id, ad, count(*) AS n, max(zaman) AS son FROM bildirimler GROUP BY hedef, ad ORDER BY son DESC LIMIT 100");
        const o = await sorgu("SELECT id, ozel AS ad, max(zaman) AS son FROM skorlar WHERE ozel IS NOT NULL GROUP BY id, ozel ORDER BY son DESC LIMIT 100");
        const k = await sorgu("SELECT id, ad, zaman FROM ad_kilit ORDER BY zaman DESC");
        return { bildirilen: b.rows.map((r) => ({ id: r.id, ad: r.ad, n: Number(r.n), son: Number(r.son) })),
          adlar: o.rows.map((r) => ({ id: r.id, ad: r.ad, son: Number(r.son) })),
          kilitli: new Map(k.rows.map((r) => [r.id, { id: r.id, ad: r.ad, son: Number(r.zaman) }])) };
      },
    };
  }
  const dosya = path.join(__dirname, "skorlar.json");
  let veri = {};
  try { veri = JSON.parse(fs.readFileSync(dosya, "utf8")); } catch (e) { veri = {}; }
  for (const t of Object.keys(TABLOLAR)) if (!veri[t]) veri[t] = {};
  if (!Array.isArray(veri._bildirim)) veri._bildirim = [];   // {hedef, bildiren, ad, zaman}
  if (!veri._kilit) veri._kilit = {};                         // kimlik -> {ad, zaman}
  let bekleyen = null;
  const kaydet = () => {
    if (bekleyen) return;
    bekleyen = setTimeout(() => { bekleyen = null; fs.writeFile(dosya, JSON.stringify(veri), () => {}); }, 2000);
  };
  const sirali = (tablo) => Object.entries(veri[tablo])
    .map(([id, k]) => ({ id, ad: k.ad, ozel: k.ozel || null, deger: k.deger, zaman: k.zaman }))
    .sort((x, y) => (TABLOLAR[tablo].kucuk ? x.deger - y.deger : y.deger - x.deger) || x.zaman - y.zaman);
  // sunucu kapanırken (Render uyuturken SIGTERM gönderir) bekleyen kayıt hemen yazılır
  const kapat = () => {
    if (bekleyen) { clearTimeout(bekleyen); bekleyen = null; try { fs.writeFileSync(dosya, JSON.stringify(veri)); } catch (e) { /* yazılamadı */ } }
    process.exit(0);
  };
  process.on("SIGTERM", kapat);
  process.on("SIGINT", kapat);
  return {
    ad: "dosya",
    async yaz(tablo, k) {
      const eski = veri[tablo][k.id];
      const daha = !eski || (TABLOLAR[tablo].kucuk ? k.deger < eski.deger : k.deger > eski.deger);
      veri[tablo][k.id] = { ad: k.ad, ozel: k.ozel, deger: daha ? k.deger : eski.deger, zaman: daha ? k.zaman : eski.zaman };
      kaydet();
    },
    async oku(tablo, id) {
      const s = sirali(tablo);
      const i = id ? s.findIndex((k) => k.id === id) : -1;
      return { satirlar: s.slice(0, LISTE_BOYU).map((k) => ({ id: k.id, ad: k.ad, ozel: k.ozel, deger: k.deger })),
        ben: i >= 0 ? { sira: i + 1, deger: s[i].deger } : null, toplam: s.length };
    },
    async sil(id) {
      let n = 0;
      for (const t of Object.keys(TABLOLAR)) if (veri[t][id]) { delete veri[t][id]; n++; }
      veri._bildirim = veri._bildirim.filter((b) => b.hedef !== id && b.bildiren !== id);
      kaydet();
      return n;
    },
    async bildir(hedef, bildiren, ad, zaman) {
      if (!veri._bildirim.some((b) => b.hedef === hedef && b.bildiren === bildiren && b.ad === ad)) {
        veri._bildirim.push({ hedef, bildiren, ad, zaman });
        kaydet();
      }
      return this.bildirimSayisi(hedef, ad);
    },
    async bildirimSayisi(hedef, ad) { return veri._bildirim.filter((b) => b.hedef === hedef && b.ad === ad).length; },
    async ozelGizle(id) {
      for (const t of Object.keys(TABLOLAR)) if (veri[t][id]) veri[t][id].ozel = null;
      kaydet();
    },
    async kilitli(id) { return Boolean(veri._kilit[id]); },
    async kilitle(id, zaman, ad) { veri._kilit[id] = { ad, zaman }; await this.ozelGizle(id); },
    async kilitAc(id) { delete veri._kilit[id]; kaydet(); },
    async bildirimSil(id) { veri._bildirim = veri._bildirim.filter((b) => b.hedef !== id); kaydet(); },
    async yonetimListesi() {
      const grup = new Map();
      for (const b of veri._bildirim) {
        const k = b.hedef + "\n" + b.ad;
        const g = grup.get(k) || { id: b.hedef, ad: b.ad, n: 0, son: 0 };
        g.n++; g.son = Math.max(g.son, b.zaman);
        grup.set(k, g);
      }
      const adlar = new Map();
      for (const t of Object.keys(TABLOLAR)) {
        for (const [id, k] of Object.entries(veri[t])) {
          if (!k.ozel) continue;
          const g = adlar.get(id + "\n" + k.ozel);
          if (!g || g.son < k.zaman) adlar.set(id + "\n" + k.ozel, { id, ad: k.ozel, son: k.zaman });
        }
      }
      return { bildirilen: [...grup.values()].sort((x, y) => y.son - x.son).slice(0, 100),
        adlar: [...adlar.values()].sort((x, y) => y.son - x.son).slice(0, 100),
        kilitli: new Map(Object.entries(veri._kilit).sort((x, y) => y[1].zaman - x[1].zaman).map(([id, k]) => [id, { id, ad: k.ad, son: k.zaman }])) };
    },
  };
}
const depo = skorDepo();

function json(res, kod, nesne) {
  res.writeHead(kod, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store" });
  res.end(JSON.stringify(nesne));
}

function gecerliKimlik(id) {
  return typeof id === "string" && /^[a-f0-9]{16,40}$/.test(id);
}

// IP başına gönderim sınırı; aşıldıysa true
function cokIstek(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const simdi = Date.now();
  const say = ipSayac.get(ip) || { t: simdi, n: 0 };
  if (simdi - say.t > IP_PENCERE) { say.t = simdi; say.n = 0; }
  say.n += 1;
  ipSayac.set(ip, say);
  return say.n > IP_SINIR;
}

function govdeOku(req, res, sinir, cb) {
  let govde = "";
  req.on("data", (p) => { govde += p; if (govde.length > sinir) req.destroy(); });
  req.on("end", () => cb(govde));
}

function skorIstek(req, res, url) {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method === "GET") {
    const tablo = url.searchParams.get("board") || "";
    const id = url.searchParams.get("id") || "";
    if (!TABLOLAR[tablo]) return json(res, 400, { error: "bad_board" });
    // satırlarda başkalarının kimliği gönderilmez; yalnızca "sen misin" bilgisi ve bildirim için iz
    depo.oku(tablo, gecerliKimlik(id) ? id : "").then((s) => json(res, 200, {
      board: tablo, total: s.toplam, me: s.ben,
      rows: s.satirlar.map((r, i) => ({ rank: i + 1, name: r.ozel || r.ad, value: r.deger, me: r.id === id, ref: iz(r.id) })),
    })).catch(() => json(res, 500, { error: "store" }));
    return;
  }
  if (req.method === "DELETE") {
    // oyuncu kendi skorlarını siler (oyundaki "Skorlarımı Sil"); kimliği yalnızca kendisi bilir
    const id = url.searchParams.get("id") || "";
    if (!gecerliKimlik(id)) return json(res, 400, { error: "bad_id" });
    depo.sil(id).then((n) => json(res, 200, { ok: true, deleted: n })).catch(() => json(res, 500, { error: "store" }));
    return;
  }
  if (req.method !== "POST") return json(res, 405, { error: "method" });
  if (cokIstek(req)) return json(res, 429, { error: "slow_down" });
  govdeOku(req, res, 1024, async (govde) => {
    let m;
    try { m = JSON.parse(govde); } catch (e) { return json(res, 400, { error: "json" }); }
    const t = TABLOLAR[m && m.board];
    const deger = Number(m && m.value);
    if (!t) return json(res, 400, { error: "bad_board" });
    if (!gecerliKimlik(m.id)) return json(res, 400, { error: "bad_id" });
    // yazılan ad "name"de metin olarak, zarla üretilen ad "gen"de gelir; zarla üretilen ad doğrudan "name"de de gelebilir
    const yazili = typeof m.name === "string";
    const ad = yazili ? m.gen : m.name;
    if (!gecerliUclu(ad)) return json(res, 400, { error: "bad_name" });
    if (!Number.isInteger(deger) || deger < t.min || deger > t.max) return json(res, 400, { error: "bad_value" });
    const simdi = Date.now();
    try {
      // yazılan ad kabul edilmezse skor yine kaydedilir, zarla üretilen adla; oyun yanıttan anlayıp adı geri alır
      let ozel = null;
      let red = null;
      if (yazili) {
        red = adHatasi(m.name);
        if (!red && await depo.kilitli(m.id)) red = "name_locked";
        if (!red && await depo.bildirimSayisi(m.id, adTemizle(m.name)) >= BILDIRIM_ESIGI) red = "name_hidden";
        if (!red) ozel = adTemizle(m.name);
      }
      await depo.yaz(m.board, { id: m.id, ad, ozel, deger, zaman: simdi });
      const s = await depo.oku(m.board, m.id);
      json(res, 200, Object.assign({ ok: true, me: s.ben, total: s.toplam }, red ? { name_rejected: red } : {}));
    } catch (e) {
      json(res, 500, { error: "store" });
    }
  });
}

// bir oyuncu tabloda gördüğü bir adı bildirir; BILDIRIM_ESIGI farklı oyuncu bildirince ad gizlenir
function bildirIstek(req, res) {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "POST") return json(res, 405, { error: "method" });
  if (cokIstek(req)) return json(res, 429, { error: "slow_down" });
  govdeOku(req, res, 512, async (govde) => {
    let m;
    try { m = JSON.parse(govde); } catch (e) { return json(res, 400, { error: "json" }); }
    if (!m || !TABLOLAR[m.board]) return json(res, 400, { error: "bad_board" });
    if (!gecerliKimlik(m.id)) return json(res, 400, { error: "bad_id" });
    if (typeof m.ref !== "string" || !/^[a-f0-9]{16}$/.test(m.ref)) return json(res, 400, { error: "bad_ref" });
    try {
      const s = await depo.oku(m.board, "");
      const hedef = s.satirlar.find((r) => iz(r.id) === m.ref);
      if (!hedef) return json(res, 404, { error: "not_found" });
      if (hedef.id === m.id) return json(res, 400, { error: "self" });
      if (!hedef.ozel) return json(res, 200, { ok: true, hidden: false });
      const n = await depo.bildir(hedef.id, m.id, hedef.ozel, Date.now());
      const gizle = n >= BILDIRIM_ESIGI;
      if (gizle) await depo.ozelGizle(hedef.id);
      console.log("ad bildirildi: " + JSON.stringify(hedef.ozel) + " (" + n + " kişi)" + (gizle ? ", gizlendi" : ""));
      json(res, 200, { ok: true, hidden: gizle });
    } catch (e) {
      json(res, 500, { error: "store" });
    }
  });
}

// ---- yönetim sayfası (/skor/yonet?anahtar=...): bildirilen ve son yazılan adlar; ad gizlenip kilitlenebilir
function anahtarDogru(a) {
  if (!YONETICI_ANAHTARI || typeof a !== "string") return false;
  const x = Buffer.from(a), y = Buffer.from(YONETICI_ANAHTARI);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const kacir = (s) => String(s).replace(/[&<>"']/g, (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[h]);

async function yonetimSayfasi(res, anahtar, not) {
  const l = await depo.yonetimListesi();
  const tarih = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
  const dugme = (r, islem, yazi) => '<form method="post" action="/skor/yonet"><input type="hidden" name="anahtar" value="' + kacir(anahtar) +
    '"><input type="hidden" name="id" value="' + kacir(r.id) + '"><input type="hidden" name="ad" value="' + kacir(r.ad) +
    '"><input type="hidden" name="islem" value="' + islem + '"><button>' + yazi + "</button></form>";
  const islemler = (r) => (l.kilitli.has(r.id) ? dugme(r, "kilit_ac", "Kilidi aç") : dugme(r, "kilitle", "Gizle ve kilitle"));
  const satir = (r, ek) => "<tr><td>" + kacir(r.ad) + "</td>" + ek + "<td>" + tarih(r.son) + "</td><td>" + (l.kilitli.has(r.id) ? "kilitli" : "") +
    "</td><td class=i>" + islemler(r) + "</td></tr>";
  const kilitler = [...l.kilitli.values()];
  const html = "<!doctype html><html lang=tr><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
    "<title>Derin Nefes adları</title><style>body{font:15px system-ui,sans-serif;margin:16px;max-width:900px}table{border-collapse:collapse;width:100%}" +
    "td,th{border-bottom:1px solid #ccc;padding:6px;text-align:left}.i{display:flex;gap:6px}.not{background:#e7f6e7;padding:8px}</style></head><body>" +
    "<h1>Liderlik tablosu adları</h1>" + (not ? "<p class=not>" + kacir(not) + "</p>" : "") +
    "<p>\"Gizle ve kilitle\": ad tablodan kalkar, oyuncu zarla üretilen adla görünür ve bir daha ad yazamaz. " + BILDIRIM_ESIGI +
    " farklı oyuncunun bildirdiği ad kendiliğinden gizlenir.</p>" +
    "<h2>Bildirilen adlar</h2><table><tr><th>Ad</th><th>Bildiren</th><th>Son</th><th>Durum</th><th></th></tr>" +
    l.bildirilen.map((r) => satir(r, "<td>" + r.n + "</td>")).join("") + (l.bildirilen.length ? "" : "<tr><td colspan=5>Bildirim yok.</td></tr>") +
    "</table><p>" + (l.bildirilen.length ? dugmeHepsi(anahtar) : "") + "</p>" +
    "<h2>Son yazılan adlar</h2><table><tr><th>Ad</th><th>Son skor</th><th>Durum</th><th></th></tr>" +
    l.adlar.map((r) => satir(r, "")).join("") + (l.adlar.length ? "" : "<tr><td colspan=4>Yazılmış ad yok.</td></tr>") + "</table>" +
    "<h2>Kilitli oyuncular</h2><table><tr><th>Kilitlendiğindeki adı</th><th>Kilit tarihi</th><th>Durum</th><th></th></tr>" +
    kilitler.map((r) => satir(r, "")).join("") + (kilitler.length ? "" : "<tr><td colspan=4>Kilitli oyuncu yok.</td></tr>") + "</table></body></html>";
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
  res.end(html);
}

function dugmeHepsi(anahtar) {
  return '<form method="post" action="/skor/yonet"><input type="hidden" name="anahtar" value="' + kacir(anahtar) +
    '"><input type="hidden" name="islem" value="bildirimleri_temizle"><button>Bütün bildirimleri yok say</button></form>';
}

function yonetIstek(req, res, url) {
  const yok = () => { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Sayfa yok\n"); };
  if (!YONETICI_ANAHTARI) return yok();
  if (cokIstek(req)) return json(res, 429, { error: "slow_down" });   // anahtar denemeleri de sayılır
  if (req.method === "GET") {
    const a = url.searchParams.get("anahtar") || "";
    if (!anahtarDogru(a)) return yok();
    yonetimSayfasi(res, a, "").catch(() => json(res, 500, { error: "store" }));
    return;
  }
  if (req.method !== "POST") return yok();
  govdeOku(req, res, 2048, async (govde) => {
    const f = new URLSearchParams(govde);
    const a = f.get("anahtar") || "";
    if (!anahtarDogru(a)) return yok();
    const id = f.get("id") || "";
    const islem = f.get("islem") || "";
    try {
      let not = "";
      if (islem === "bildirimleri_temizle") {
        for (const r of (await depo.yonetimListesi()).bildirilen) await depo.bildirimSil(r.id);
        not = "Bildirimler temizlendi.";
      } else if (!gecerliKimlik(id)) {
        not = "Geçersiz oyuncu.";
      } else if (islem === "kilitle") {
        await depo.kilitle(id, Date.now(), adTemizle(f.get("ad") || "").slice(0, 40));
        await depo.bildirimSil(id);
        not = "Ad gizlendi; bu oyuncu artık ad yazamaz.";
      } else if (islem === "kilit_ac") {
        await depo.kilitAc(id);
        not = "Kilit açıldı.";
      }
      await yonetimSayfasi(res, a, not);
    } catch (e) {
      json(res, 500, { error: "store" });
    }
  });
}
// IP sayaçları yalnızca bellekte, kısa süre: eskiler düzenli silinir
setInterval(() => { const s = Date.now(); for (const [ip, v] of ipSayac) if (s - v.t > IP_PENCERE) ipSayac.delete(ip); }, 60000).unref();

const sunucu = http.createServer((req, res) => {
  const yol = String(req.url || "/").split("?")[0];
  if (yol === "/skor") return skorIstek(req, res, new URL(String(req.url || "/"), "http://x"));
  if (yol === "/skor/bildir") return bildirIstek(req, res);
  if (yol === "/skor/yonet") return yonetIstek(req, res, new URL(String(req.url || "/"), "http://x"));
  if (sayfalar[yol]) {
    fs.readFile(path.join(__dirname, sayfalar[yol]), (hata, icerik) => {
      if (hata) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Sayfa yok\n"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      res.end(icerik);
    });
    return;
  }
  // sağlık sayfası: hizmetler bununla sunucunun ayakta olduğunu anlar; sayfa açılınca da uyandırmak için çağrılır
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end("Derin Nefes oda sunucusu çalışıyor. Açık oda: " + odalar.size + "\n");
});

const wss = new WebSocketServer({
  server: sunucu,
  maxPayload: MESAJ_SINIRI,
  // telefondaki uygulama (Godot) tarayıcı gibi Origin başlığı göndermez; site kısıtı yalnızca tarayıcılara uygulanır
  verifyClient: (info) => izinli.length === 0 || !info.origin || izinli.includes(String(info.origin)),
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
