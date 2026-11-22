# Plure

Plure adalah aplikasi web dan dashboard orkestrasi coding multi-AI mandiri (*100% original clean-room codebase*) untuk mengendalikan agen coding lokal dari PC maupun HP:

- **COO (Koordinator Utama):** Devin CLI dengan default **Kimi K3.1 Pro Max** (`kimi-k3.1-pro-max`), dapat diganti langsung ke model lain kapan saja.
- **Implementer Kode:** Claude Code (`claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5`).
- **Riset dan Audit:** Antigravity (`gemini-2.5-pro`, `hydrogen-medium`, `gemini-2.5-flash`).
- **Live Model Switchboard:** Ubah provider dan model secara langsung baik sebelum maupun di tengah jalannya misi, disinkronkan secara *real-time* lewat Server-Sent Events (SSE).
- **Inspektur Repository Git:** Pantau branch, daftar file berubah, dan baca `git diff` langsung dari browser PC atau HP pada repository yang diizinkan.
- **Akses Aman dari HP:** Autentikasi sesi `HttpOnly` berbasis kode pairing sekali pakai (kompatibel dengan jaringan Wi-Fi lokal `--lan` maupun Tailscale) tanpa pernah menyimpan atau mengirim API key ke browser.

## Persyaratan

- Node.js 24 LTS atau Node.js 26+ (memakai modul standar `node:http`, `node:sqlite`, `node:test`, tanpa dependensi npm eksternal)
- Git

## Menjalankan

```powershell
cd D:\reverse-engineering\workspace\plure
npm test
npm run build
npm start -- --lan
```

Buka URL pairing lokal yang tampil di terminal pada browser PC Anda, atau klik tombol **Sambungkan HP** di pojok kanan atas dashboard untuk membuat kode sekali pakai bagi perangkat HP.

## Menghubungkan Langganan AI di Komputer Host

Jalankan login satu kali pada terminal komputer host (kredensial tetap berada di komputer Anda):

- **Devin CLI (COO Kimi):** `devin auth login`
- **Claude Code:** `claude auth login`
- **Antigravity:** `agy login`
