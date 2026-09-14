# RIST Multi-Receiver Dashboard

Sistem RIST receiver canggih dengan dukungan **Multiple Streams Dinamis**, **Autentikasi Publisher & Playback (AES-128)**, **Auto-IP Detection**, serta **Integrasi Statistik NOALBS**.

Dibangun di atas engine [libRIST](https://code.videolan.org/rist/librist) (v0.2.x), terinspirasi oleh fleksibilitas [OpenIRL/srtla-receiver](https://github.com/OpenIRL/srtla-receiver) dan stabilitas [moo-the-cow/moo-rist-hosting-docker](https://github.com/moo-the-cow/moo-rist-hosting-docker).

---

## 🌟 Fitur Utama

- **Management API Key Protection**: Dashboard dan seluruh REST API dilindungi oleh file `.apikey` rahasia 32-karakter. Hanya pemilik server yang dapat mengakses, mengedit, atau membuat stream.

- **Multiple Channels Dinamis**: Mengalokasikan sepasang port (Ingest & Play) baru secara otomatis untuk setiap stream yang Anda buat via UI.
- **Auto IP Switcher**: Deteksi otomatis IP Publik (WAN) dan LAN. Ganti semua URL RIST di dashboard antara Public, LAN, Localhost, atau Custom DDNS hanya dengan satu klik.
- **Keamanan Dua Lapis (Dual-Auth)**:
  - *Publisher (IRLBOX/Moblin)*: Menggunakan Autentikasi SRP Username & Password.
  - *Playback (OBS)*: Dilindungi oleh token enkripsi rahasia **AES-128**.
- **Edit Kredensial Langsung**: Bisa mengganti Username/Password publisher di tengah jalan via UI. Sistem akan melakukan *Graceful Restart* secara otomatis pada port tersebut tanpa memutus stream lainnya.
- **Bulletproof Real-time Stats**: Dual-engine log parser (Membaca libRIST `schema_version 5` dari stdout dan UDP) memastikan Bitrate, RTT, dan Packet Loss selalu tampil real-time 100% tanpa delay.
- **NOALBS Native Support**: Format API statistik menyerupai *SrtLiveServer / OpenIRL*, siap dicolok langsung ke auto scene switcher NOALBS.

---

## 🏗 Arsitektur Sistem

Setiap channel mendapatkan satu set proses `ristreceiver` dan `ristsender` terpisah untuk meminimalisasi *latency* dan menjamin keamanan enkripsi yang terisolasi.

```text
[IRLBOX / Moblin] -> ristreceiver (Port 203x, Auth SRP) 
                          | (Internal UDP 2000x + Stats Parser) 
                          v
[OBS / vMix]      <- ristsender   (Port 555x, Auth AES-128)
```

**Web Dashboard & REST API** terpusat di `http://<SERVER_IP>:3000`

---

## 💻 Panduan Instalasi Lokal (PC / Laptop Windows & Mac)

Instalasi di PC lokal sangat cocok jika Anda ingin menerima feed kamera di jaringan Wi-Fi rumah yang sama atau PC lokal Anda memiliki IP Public Statis / Port Forwarding.

### 1. Prasyarat
- Pasang [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Pastikan Docker Desktop sudah berjalan/running).
- Pasang [Git](https://git-scm.com/).

### 2. Langkah Instalasi
1. Clone atau Download ZIP repository ini:
   ```bash
   git clone https://github.com/Fajri2R/rist-multi-receiver.git
   cd rist-multi-receiver
   ```
2. Jalankan skrip `install.bat` (klik dua kali `install.bat` dari File Explorer Windows Anda).
   - *Skrip ini akan otomatis mencari port web yang kosong jika port default 3000 sedang dipakai oleh aplikasi lain (misalnya Node/Grafana) agar tidak error (port collision).*

### 3. Akses Dashboard
Buka browser dan buka:
- Dari PC yang sama: `http://localhost:3000`
- Dari HP / laptop lain di Wi-Fi yang sama: `http://<IP_LAN_KOMPUTER_ANDA>:3000` (misal: `http://192.168.1.50:3000`)

---

## ☁️ Panduan Instalasi di VPS (Ubuntu / Debian Linux)

Sangat direkomendasikan untuk **IRL Streaming di luar ruangan** menggunakan koneksi seluler 4G/5G (Moblin/IRLBOX/Belabox) karena VPS memiliki IP Publik statis dan bandwidth *unmetered*.

### 1. Siapkan VPS & Update Sistem
Login ke VPS via SSH, lalu perbarui paket:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw
```

### 2. Pasang Docker & Docker Compose
Gunakan skrip instalasi resmi Docker:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Izinkan user saat ini menjalankan docker tanpa sudo (opsional)
sudo usermod -aG docker $USER
```

### 3. Konfigurasi Firewall (PENTING!)
Agar aliran stream RIST dan Dashboard dapat diakses, buka port-port berikut di firewall UFW:
```bash
# Buka Port SSH (agar tidak terkunci keluar)
sudo ufw allow 22/tcp

# Buka Web Dashboard UI & NOALBS API
sudo ufw allow 3000/tcp

# Buka Port Input RIST (Kamera / IRLBOX ke VPS)
sudo ufw allow 2030:2050/udp

# Buka Port Forward RIST (VPS ke OBS Studio)
sudo ufw allow 5556:5576/udp

# Aktifkan Firewall
sudo ufw enable
sudo ufw status
```
*(Catatan: Jika Anda menggunakan AWS EC2, Google Cloud, atau Oracle Cloud, pastikan Anda juga membuka port di atas pada Security Group / Firewall dashboard web penyedia VPS).*

### 4. Clone & Jalankan RIST Multi-Receiver
Gunakan *auto-installer script* yang akan **secara otomatis mencari port web yang kosong** (jika port default 3000 sedang dipakai aplikasi lain) dan mengonfigurasi IP otomatis:

```bash
# Unduh source code
git clone https://github.com/Fajri2R/rist-multi-receiver.git
cd rist-multi-receiver

# Jalankan skrip auto installer
bash install.sh
```

### 5. Kelola Container di VPS
```bash
# Melihat log realtime
docker compose logs -f

# Menghentikan server
docker compose down

# Merestart server
docker compose restart
```

Buka browser Anda di: `http://<IP_PUBLIK_VPS>:3000`

---

## 📺 Panduan Penggunaan URL

Semua URL ini akan langsung digenerate secara otomatis oleh Web Dashboard. Anda hanya perlu menekan tombol **Copy**.

### URL Ingest/Publish (Untuk Aplikasi Kamera / IRLBOX)
Digunakan pada Moblin, Larix Broadcaster, IRLWhatever, atau Belabox:
```text
rist://<AKTIF_IP>:<RECEIVE_PORT>?username=<USER>&password=<PASS>
```

### URL Playback (Untuk OBS Studio / VLC)
Masukkan ke **Media Source** di OBS (hapus centang "Local File"). Token AES ini mencegah port Anda dibajak pihak luar:
```text
rist://<AKTIF_IP>:<FORWARD_PORT>?cname=<STREAM_ID>&aes-type=128&secret=<32_CHAR_SECRET_TOKEN>
```

---

## 📊 Integrasi NOALBS (Auto Scene Switcher)

Sistem ini mendukung format statistik `OpenIRL` bawaan NOALBS.
Masukkan konfigurasi berikut pada `config.json` NOALBS Anda:

```json
{
  "streamServer": {
    "type": "OpenIRL",
    "statsUrl": "http://<SERVER_IP>:3000/stats/<streamId>"
  }
}
```
*(Catatan: Anda bisa menyalin URL `statsUrl` langsung melalui tombol STATS di Web Dashboard).*

---

## ⚙️ Ports Mapping

| Port Range  | Protokol | Keterangan                                       |
|-------------|----------|--------------------------------------------------|
| 3000        | TCP      | Web Dashboard UI, REST API, & Endpoint NOALBS    |
| 2030–2050   | UDP      | **RIST Input** (Kamera/IRLBOX ke Server)         |
| 5556–5576   | UDP      | **RIST Output** (di-forward ke OBS Studio)       |

> **PENTING (Spesifikasi Port RIST):**
> Protokol RIST Main Profile menggunakan **sepasang port UDP (Port Pair)** untuk setiap channel:
> - Port **Genap** untuk aliran data video (RTP).
> - Port **Ganjil** (Port + 1) untuk feedback kontrol RTCP (handshake, RTT, & recovery packet loss).
> 
> Karena itu, sistem ini otomatis mengalokasikan port melompat 2 nomor secara aman:
> - **Channel 1:** Port Ingest `2030` (Data: 2030, RTCP: 2031) -> Forward OBS `5556` (RTCP: 5557)
> - **Channel 2:** Port Ingest `2032` (Data: 2032, RTCP: 2033) -> Forward OBS `5558` (RTCP: 5559)
> - **Channel 3:** Port Ingest `2034` (Data: 2034, RTCP: 2035) -> Forward OBS `5560` (RTCP: 5561)

---

## 🛠 Modifikasi Tingkat Lanjut

Anda dapat memodifikasi batas rentang port, RTT minimum, maupun Profile RIST dengan mengedit file `config.js` sebelum me-rebuild Docker.
- `ristProfile: "1"` = Main Profile (Default standar IRLBOX/Moblin)
- `ristProfile: "2"` = Advanced Profile





