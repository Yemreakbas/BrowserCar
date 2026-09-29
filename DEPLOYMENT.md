# BrowserCar — Dağıtım ve Canlıya Alma Rehberi (Deployment Guide)

Bu rehber, **BrowserCar** 3D çok oyunculu yarış ve drift oyununu canlı ortama (production) nasıl dağıtacağınızı adım adım açıklamaktadır.

---

## 🏗️ 1. Mimari Genel Bakış

BrowserCar iki ana bileşenden oluşur:
1. **İstemci (Client — Three.js + Rapier + Vite):**
   - Tamamen statik HTML, CSS, JavaScript ve 3D varlıklardan (`.glb`, `.wav`) oluşur.
   - Herhangi bir statik CDN/Hosting servisinde (Vercel, Netlify, Cloudflare Pages) barındırılabilir.
2. **Sunucu (Multiplayer Server — Node.js + Socket.IO):**
   - 20 Hz yetkili (authoritative) araç simülasyonu, oda yönetimi, anti-cheat doğrulaması ve REST liderlik tablosu sunar.
   - Kesintisiz (persistent) WebSocket/WSS bağlantılarını destekleyen bir ortamda (Render, Railway, Fly.io veya Docker VPS) barındırılmalıdır.

---

## 🚀 2. Hızlı Yerel Ağ (LAN) Testi — Farklı Cihazlardan Oynama

Aynı Wi-Fi/yerel ağdaki telefon, tablet veya başka bir bilgisayardan test etmek için:

1. **Sunucuyu başlatın:**
   ```powershell
   npm run server
   ```
2. **İstemciyi tüm ağa açık şekilde önizleyin:**
   ```powershell
   npm run build
   npx vite preview --host
   ```
3. Terminalde gösterilen yerel IP adresini (Örn: `http://192.168.1.50:4173`) mobil cihazınızın veya diğer bilgisayarınızın tarayıcısında açın.
4. Oyun, sunucuya otomatik olarak `http://192.168.1.50:3001` üzerinden bağlanacaktır!

---

## 🌐 3. Sunucu Dağıtımı (Multiplayer Backend)

### Seçenek A: Render.com (Önerilen & Ücretsiz)
1. [Render.com](https://render.com) üzerinde ücretsiz bir hesap oluşturun.
2. **New +** > **Blueprint** seçin ve GitHub deponuzu (`Yemreakbas/BrowserCar`) bağlayın.
3. Projedeki `render.yaml` dosyası otomatik olarak algılanacaktır.
4. Hizmet kurulduğunda size özel bir URL verilecektir (Örn: `https://browsercar-server.onrender.com`).
5. `https://browsercar-server.onrender.com/health` adresine giderek çalıştığını doğrulayın (`status: "ok"`).

### Seçenek B: Railway.app
1. [Railway.app](https://railway.app) üzerinde yeni bir proje oluşturun.
2. **Deploy from GitHub repo** seçin ve `BrowserCar` deposunu bağlayın.
3. `railway.json` ve `Dockerfile` dosyaları otomatik olarak projeyi derleyip çalıştıracaktır.
4. **Networking** sekmesinden genel bir alan adı (Public Domain) oluşturun.

### Seçenek C: Kendi VPS / Docker Sunucunuz
```bash
# Docker Compose ile tek komutla ayağa kaldırın:
docker compose up -d --build

# Durumu kontrol edin:
curl http://localhost:3001/health
```

---

## ⚡ 4. İstemci Dağıtımı (Client Frontend)

### Seçenek A: Vercel (Önerilen)
1. [Vercel.com](https://vercel.com) üzerinde **Add New Project** deyin.
2. GitHub deponuzu seçin.
3. **Build Command:** `npm run build`
4. **Output Directory:** `dist`
5. **Environment Variables:**
   - Key: `VITE_SERVER_URL`
   - Value: `https://sunucu-adresiniz.onrender.com` (Adım 3'te aldığınız sunucu URL'i)
6. **Deploy** butonuna tıklayın.

### Seçenek B: Netlify
1. [Netlify.com](https://netlify.com) üzerinde deponuzu bağlayın.
2. Projedeki `netlify.toml` derleme ve yönlendirme kurallarını otomatik yapılandıracaktır.
3. **Site configuration > Environment variables** alanına `VITE_SERVER_URL` değerinizi ekleyin.
4. Dağıtımı tamamlayın.

---

## 🔒 5. Canlı Ortam Güvenlik ve Ayarlar (WSS & CORS)

- **HTTPS / WSS Uyumu:**
  - İstemciniz `https://` üzerinden yayınlandığında, modern tarayıcılar "Mixed Content" kısıtlaması nedeniyle `http://` WebSocket bağlantılarını engeller.
  - Bu nedenle sunucunuzun da HTTPS/WSS destekli bir alan adına (Render/Railway varsayılan olarak SSL sağlar) sahip olması gereklidir.
- **Dinamik Sunucu Bağlantısı:**
  - Dağıtım sonrası dilediğiniz sunucuya bağlanmak için URL sonuna parametre ekleyebilirsiniz:
    `https://browsercar.vercel.app/?server=https://özel-sunucu.com`
- **CORS İzinleri:**
  - Sunucu ortam değişkenlerinde `CORS_ORIGIN` değişkenini tanımlayarak bağlantıları yalnızca kendi alan adınızla sınırlandırabilirsiniz:
    `CORS_ORIGIN=https://browsercar.vercel.app`

---

## ✅ 6. Canlı Doğrulama Testi (Acceptance Test)

1. Farklı ağlardan/cihazlardan (Örn: mobil hücresel veri ve ev interneti) istemci linkini açın.
2. HUD üzerindeki **Online** göstergesini ve yeşil bağlantı ışığını kontrol edin.
3. İki farklı cihazdan aynı odaya (Örn: "Şehir Serbest Sürüş") girin.
4. Araçların senkronize hareketini, drift skorlarını ve yarış kontrol noktalarını doğrulayın.
