# RIST Multi Receiver

RIST receiver dengan dukungan **multiple streams**, **autentikasi dinamis per stream**, dan **integrasi statistik** (NOALBS, dashboard real-time).

Dibangun di atas [libRIST](https://code.videolan.org/rist/librist) dan terinspirasi dari [OpenIRL/srtla-receiver](https://github.com/OpenIRL/srtla-receiver) dan [moo-the-cow/moo-rist-hosting-docker](https://github.com/moo-the-cow/moo-rist-hosting-docker).

---

## Arsitektur

```
[IRLBOX/IRLWhatever] -> ristreceiver (2030/udp) -> internal udp -> ristsender (5556/udp) -> [OBS]
[IRLBOX 2]           -> ristreceiver (2031/udp) -> internal udp -> ristsender (5557/udp) -> [OBS 2]
...setiap stream mendapatkan pasangan port unik secara otomatis
```

Management API + Dashboard tersedia di `http://server:3000`

---

## Quick Start (Docker)

```bash
docker compose up -d
```

Buka http://localhost:3000 lalu klik **Add Stream** untuk membuat stream baru.

---

## URL Publish (dari IRLBOX / IRLWhatever / Belabox)

```
rist://<SERVER_IP>:<RECEIVE_PORT>?username=<user>&password=<pass>
```

## URL Play (dari OBS Studio)

```
rist://<SERVER_IP>:<FORWARD_PORT>
```

Masukkan URL di OBS > Media Source > uncheck "Local File".

---

## Statistik NOALBS

Konfigurasi NOALBS `config.json` Anda:

```json
{
  "streamServer": {
    "type": "OpenIRL",
    "statsUrl": "http://<SERVER_IP>:3000/stats/<streamId>"
  }
}
```

`streamId` bisa dilihat dan disalin langsung dari Web Dashboard.

---

## Ports

| Port        | Protokol | Keterangan                          |
|-------------|----------|-------------------------------------|
| 3000        | TCP      | Web Dashboard + REST API + Stats    |
| 2030–2050   | UDP      | RIST Input (1 port per stream)      |
| 5556–5576   | UDP      | RIST Output/Forward ke OBS          |

---

## RIST Profile

Edit `config.js`:
- `ristProfile: "1"` = Main Profile (default, kompatibel dengan IRLBOX)
- `ristProfile: "2"` = Advanced Profile
