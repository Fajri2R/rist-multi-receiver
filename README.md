# RIST Multi-Receiver Dashboard

Sistem RIST receiver canggih dengan dukungan **Multiple Streams Dinamis**, **Autentikasi Publisher & Playback (AES-128)**, **Auto-IP Detection**, serta **Integrasi Statistik NOALBS**.

Dibangun di atas engine [libRIST](https://code.videolan.org/rist/librist) (v0.2.x), terinspirasi oleh fleksibilitas *OpenIRL/srtla-receiver* dan stabilitas *moo-rist-hosting-docker*.

---

## 🌟 Fitur Utama

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

## 🚀 Quick Start (Docker)

1. Pastikan Anda telah menginstal **Docker** dan **Docker Compose**.
2. Clone repository ini dan masuk ke direktorinya.
3. Jalankan perintah berikut:

```bash
docker compose up -d --build
```

Buka **http://localhost:3000** (atau IP server Anda). Klik **Add Channel** untuk membuat konfigurasi stream pertama Anda.

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
| 2030–2050   | UDP      | **RIST Input** (dari IRLBOX/Moblin ke Server)    |
| 5556–5576   | UDP      | **RIST Output** (di-forward ke OBS Studio)       |

Jika Anda menggunakan VPS/Server Cloud, pastikan Anda **membuka port-port di atas pada Firewall (UFW / AWS Security Group)**.

---

## 🛠 Modifikasi Tingkat Lanjut

Anda dapat memodifikasi batas rentang port, RTT minimum, maupun Profile RIST dengan mengedit file `config.js` sebelum me-rebuild Docker.
- `ristProfile: "1"` = Main Profile (Default standar IRLBOX/Moblin)
- `ristProfile: "2"` = Advanced Profile
