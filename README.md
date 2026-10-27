# Derin Nefes oda sunucusu

Oyunun sitedeki (itch.io) sürümünde ve Android uygulamasında **Arkadaşla Oyna** ve **Liderlik** bu küçük sunucuya
bağlanır.

- **Arkadaşla Oyna:** sunucu yalnızca iki oyuncu arasında mesaj taşır (oda kodu, oyuncunun görünüşü, hamlenin
  şifreli özeti, açılan hamle). Bunların hiçbirini kaydetmez.
- **Liderlik tablosu** (`/skor`): Speedrun, Souls ve Sonsuz tabloları. Her oyuncu için rastgele kimlik, takma ad
  (oyuncunun yazdığı ya da zarla üretilen) ve en iyi skor saklanır. Oyuncu "Skorlarımı Sil" ile kendi skorlarını siler.
  Yazılan adlar kötü söz süzgecinden geçer ve bildirilebilir (`/skor/bildir`); iki farklı oyuncunun bildirdiği ad
  kendiliğinden gizlenir.

## Render'da ücretsiz çalıştırmak

1. **GitHub:** github.com'da hesap aç. Sağ üstten **New repository** → ad: `derin-nefes-sunucu` → Create.
   Açılan sayfada **uploading an existing file** bağlantısına tıkla, bu klasördeki `server.js`,
   `package.json`, `gizlilik.html` ve `privacy.html` dosyalarını sürükle → **Commit changes**.
2. **Render:** render.com'a **GitHub ile** giriş yap → **New +** → **Web Service** → `derin-nefes-sunucu`
   deposunu seç.
   - Language / Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
   - **Deploy** (ya da Create Web Service).
3. Birkaç dakika sonra sayfanın üstünde adres çıkar, ör. `https://derin-nefes-sunucu.onrender.com`.
   Tarayıcıda aç: "Derin Nefes oda sunucusu çalışıyor" yazmalı.
4. Oyunun sitedeki sürümünde bu adres `wss://` ile yazılır:
   `python3 tools/build_site.py wss://derin-nefes-sunucu.onrender.com derin-nefes-itch.zip`

**Ücretsiz planda:** 15 dakika kimse bağlanmazsa sunucu uyur; ilk bağlantıda yaklaşık bir dakikada uyanır.
Oyun sayfası açılır açılmaz sunucuyu uyandırır, oda kurulana kadar genelde kalkmış olur; ilk denemede
"Oda kuruluyor..." biraz uzun sürebilir.

## Liderlik skorlarını kalıcı yapmak (isteğe bağlı, önerilir)

Veritabanı vermezsen skorlar sunucunun yanındaki `skorlar.json` dosyasında durur. Render'ın ücretsiz planında
sunucu uyuyup kalkınca ya da yeniden yüklenince bu dosya **silinir**, tablo boşalır. Kalıcı olması için ücretsiz bir
Postgres veritabanı bağla (5 dakika):

1. **neon.tech** → **Sign up** (GitHub ile girebilirsin) → yeni proje: ad `derin-nefes`, bölge olarak
   Render sunucuna yakın olanı seç (ör. Frankfurt / AWS eu-central-1) → **Create**.
2. Açılan **Connect** penceresinde (ya da Dashboard → **Connect**) bağlantı adresini kopyala. Şuna benzer:
   `postgresql://kullanici:sifre@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
   Bu adreste şifre vardır; kimseyle paylaşma, GitHub'a yükleme.
3. **Render** → `derin-nefes-sunucu` → **Environment** → **Add Environment Variable**:
   Key `DATABASE_URL`, Value: kopyaladığın adres → **Save Changes**. Render sunucuyu kendiliğinden yeniden başlatır.
4. Render'da **Logs** sekmesinde hata görmemelisin. "veritabanına bağlanılamadı" yazıyorsa adresi yeniden kopyala.
   Sunucu bu durumda da çalışmaya devam eder; yalnızca liderlik tablosu açılmaz.

Tablo (`skorlar`) ilk istekte kendiliğinden kurulur, başka bir şey yapman gerekmez. Neon'un ücretsiz planı bu
oyun için fazlasıyla yeter; veritabanı boşta uyur, ilk istekte bir iki saniyede uyanır.

## Oyuncu adlarını yönetmek (önerilir)

Oyuncular takma adlarını kendileri yazabildiği için Google Play bildirilen adlarla ilgilenmeni bekler. Bunun için
küçük bir yönetim sayfası var:

1. Uzun, tahmin edilemez bir anahtar uydur (ör. 20+ harf ve rakam). Kimseyle paylaşma.
2. **Render** → `derin-nefes-sunucu` → **Environment** → **Add Environment Variable**: Key `YONETICI_ANAHTARI`,
   Value: anahtarın → **Save Changes**.
3. Tarayıcıda aç (yer işaretlerine ekleyebilirsin):
   `https://derin-nefes-sunucu.onrender.com/skor/yonet?anahtar=ANAHTARIN`
4. Sayfada bildirilen adlar ve son yazılan adlar görünür. Uygunsuz bir ad için **Gizle ve kilitle**: ad tablodan
   kalkar, o oyuncu zarla üretilen adla görünür ve bir daha ad yazamaz. Yanlışlıkla kilitlediysen **Kilidi aç**.
   Haksız bildirimler için **Bütün bildirimleri yok say**.

Haftada bir bakman yeter. Render'daki **Logs** sekmesinde her bildirim "ad bildirildi: ..." diye de görünür.
Anahtar verilmezse sayfa kapalıdır (adres "Sayfa yok" der); süzgeç ve bildirimle gizleme yine çalışır.

## Daha önce yüklediysen: güncelleme

GitHub'daki `derin-nefes-sunucu` deposunda **Add file → Upload files** ile bu klasördeki `server.js`,
`package.json`, `gizlilik.html` ve `privacy.html` dosyalarını yeniden sürükle → **Commit changes**. Render yeni
sürümü kendiliğinden kurar (`package.json` yeni `pg` paketini getirir). Gizlilik dosyalarında `ILETISIM_EPOSTA`
yerine e-postanı yazmayı unutma.

## Bu oyunun sunucusu

`https://derin-nefes-sunucu.onrender.com` → oyunda `wss://derin-nefes-sunucu.onrender.com`
(itch.io paketi: `python3 tools/build_site.py wss://derin-nefes-sunucu.onrender.com derin-nefes-itch.zip`)

## Gizlilik politikası (Google Play için)

`gizlilik.html` (Türkçe) ve `privacy.html` (İngilizce) bu klasörde durur. GitHub deposuna `server.js` ile birlikte
yüklenince iki yerden açılırlar:

- Sunucudan: `https://derin-nefes-sunucu.onrender.com/gizlilik` ve `/privacy`
- GitHub Pages'ten (her zaman açık, uyumaz; Play Console'a bu adres yazılır): depoda **Settings → Pages →
  Deploy from a branch → main / (root) → Save**; birkaç dakika sonra
  `https://KULLANICI_ADIN.github.io/derin-nefes-sunucu/gizlilik.html`

Yüklemeden önce iki dosyada da `ILETISIM_EPOSTA` yazısını kendi iletişim e-postanla değiştir (GitHub'da dosyayı
açıp kalem simgesiyle de düzenleyebilirsin).

## İsteğe bağlı ayar

- `DATABASE_URL`: liderlik skorları için Postgres adresi (yukarıya bak). Yerelde SSL'siz bir Postgres
  kullanıyorsan ayrıca `DATABASE_SSL=0` ver.
- `YONETICI_ANAHTARI`: ad yönetim sayfasının anahtarı (yukarıya bak).
- `SKOR_IP_SINIRI`: bir IP'den 10 dakikada en çok kaç skor/bildirim (varsayılan 40; sınamalarda büyütülür).
- `IZINLI_ADRESLER`: tarayıcıdan yalnızca bu sitelerden bağlanılsın (virgülle ayır). Boş bırakırsan her yerden
  bağlanılır; oyun bunun için bir şey saklamadığından boş bırakmak sorun değildir. Android uygulaması site adresi
  göndermediği için bu ayardan etkilenmez, her durumda bağlanır.

## Yerelde denemek

```
npm install
YONETICI_ANAHTARI=deneme SKOR_IP_SINIRI=1000 PORT=8099 node server.js   # bir pencerede
YONETICI_ANAHTARI=deneme PORT=8099 node test.js                         # başka pencerede: "SUNUCU TAMAM" yazmalı
```

Postgres ile denemek için sunucuyu `DATABASE_URL=postgres://... DATABASE_SSL=0 PORT=8099 node server.js` ile başlat.
