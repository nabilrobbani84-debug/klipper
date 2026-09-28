# Deploy ke Firebase Hosting

Aplikasi ini adalah SPA statis (Vite + React). Hasil build (`dist/`) di-host di Firebase Hosting.

## Opsi A — Otomatis via GitHub Actions

Workflow: `.github/workflows/firebase-hosting.yml`
- Push ke `main` → deploy ke **live**
- Pull request → deploy ke **preview channel** (URL dikomentari di PR)

Setup satu kali:
1. Buat project di <https://console.firebase.google.com> lalu aktifkan **Hosting**.
2. Buat service account key: Google Cloud Console → IAM & Admin → Service Accounts → buat akun
   dengan role **Firebase Hosting Admin** (dan **API Keys Viewer**) → Keys → Add key (JSON).
   *(Alternatif: `npx firebase-tools init hosting:github` membuat secret ini otomatis.)*
3. Di GitHub repo → Settings → Secrets and variables → Actions:
   - Secret `FIREBASE_SERVICE_ACCOUNT` = isi file JSON tadi
   - Variable `FIREBASE_PROJECT_ID` = ID project Firebase
   - (Opsional) Secret `VITE_GEMINI_API_KEY`
4. Push ke `main` atau jalankan workflow secara manual (tab Actions → Run workflow).

## Opsi B — Manual dari komputer lokal

```bash
bun install
npx firebase-tools login
npx firebase-tools use --add      # pilih project Firebase
bun run deploy                    # build + deploy
```

## Catatan keamanan

`VITE_GEMINI_API_KEY` akan tertanam di bundle JavaScript publik dan bisa dilihat siapa pun.
Tanpa key, aplikasi tetap berjalan dengan data fallback. Jika ingin memakai Gemini di produksi,
batasi key tersebut (HTTP referrer = domain Firebase Anda) di Google Cloud Console, atau pindahkan
panggilan Gemini ke backend (mis. Cloud Functions).
