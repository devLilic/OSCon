# Roadmap OSCon și Definition of Done

Pe 4 octombrie 2026 utilizatorul a prioritizat explicit copia funcțională OSC-lab, cu UI/UX și Settings reorganizate, fără SQLite. [Portarea curentă](osc-lab-port.md) adaptează nucleul de referință; etapele generice MOS/Plasma de mai jos rămân pentru intervenții ulterioare. Setările salvate în dev trebuie incluse drept defaults în buildul de producție, fără a înlocui configurarea locală existentă și fără tokenul de dezvoltare.

## Portul OSC-lab — starea curentă

Pe 5 octombrie 2026, portul funcțional cu Status, Settings, Diagnostic și Preview este implementat și verificat. Runtime-ul și pachetul nu includ modulul sau dependențele SQLite; defaults dev sunt incluse în producție, setările locale valide au prioritate, iar configurațiile corupte blochează comenzile până la reparare explicită. Salvările și restaurările rezervă controllerul; schimbarea receiverului revine la `UNKNOWN` fără OSC automat.

Verificări: `npx tsc --noEmit`; 184 teste în 41 fișiere; `npm run build` cu installer NSIS x64; pornire `npm run dev` și smoke UI prin Vite; smoke Electron cu configurare normală și coruptă; smoke pe executabilul Windows împachetat. Defaults din `resources/defaults` sunt identice cu sursele, preview-ul este inclus, iar dependențele SQLite lipsesc din ASAR. Testele UI nu au trimis datagrame OSC și nu au schimbat defaults reale.

Acceptanța pe output-ul LiveBoard real și adaptarea clientului Plasma/MOS rămân etapele următoare. Etapele generice numerotate mai jos sunt roadmap-ul extins, nu rezultate pretinse ale acestui port.

Lucrează taskurile în ordinea de mai jos. Fiecare etapă se încheie înainte de următoarea; păstrează schimbările înguste, adaugă teste de logică și actualizează aceste documente când se schimbă un contract.

## Etapa 0 — Inițializare și bază

- Stabilește metadata `OSCon` / `oscon` / `ro.devlilic.oscon`, româna implicită, i18n și logging active; modulele opționale fără scop în MVP rămân inactive.
- Rulează typecheck, unit tests și build înaintea schimbărilor; repară strict defecțiunile preexistente confirmate.
- Baseline pe checkout: `npx tsc --noEmit` a trecut; `npm run test:unit` a avut 119 teste trecute și 4 eșuate în 3 fișiere. Defectele erau două așteptări i18n pentru fallback englezesc în timp ce configurația declară româna, lista IPC fără canalele licensing existente și un timestamp static din martie 2026 care ieșise din grace period. `npm run build` a trecut TypeScript, Vite pentru renderer/main/preload și packaging Windows x64.
- Remedieri baseline: așteptările i18n urmează limba configurată, lista IPC enumeră toate canalele curente, iar verificarea grace period folosește o validare recentă relativă la momentul rulării.
- Stare: completă. Metadata, defaults, onboarding și installerul Windows x64 sunt aliniate pentru OSCon; publicarea automată este dezactivată. Verificare după schimbări: `npx tsc --noEmit` a trecut, `npm run test:unit` a raportat 123/123 teste trecute, iar `npm run build` a produs `release/0.1.0/OSCon-0.1.0-x64.exe` (NSIS, x64).
- DoD: metadata proiectului identifică OSCon, toate testele de bază trec, build-ul Windows x64 reușește, iar README-ul explică rularea în development și verificările locale.

## Etapa 1 — Contracts, settings și profiles

- Definește contracts shared pentru OSC, HTTP, state, profil, parametri, mapări, file sources, groups, comenzi, stări și timinguri.
- Creează store de setări OSCon versionat, validat, atomic în `userData`; adaugă UI de setup/settings și regenerarea tokenului.
- Construiește create/edit/validate de profil pentru TXT și JSON cu one/two buffers, content names și grupuri.
- DoD: teste deterministe pentru defaults, load/save/corruption/version, căi/configurații invalide și coliziuni în grupuri.

## Etapa 2 — Sursă de date și transport OSC

- Implementează scriere TXT/JSON în main și encoder OSC cu destinație/acțiuni permise configurate.
- Adaugă delay barrier cu operație anulabilă numai înaintea transmiterii și diagnostic de etapă; transmite numai după write+delay reușite.
- DoD: teste diacritice, empty strings, preservation JSON, replace eșuat, OSC packet padding/string encoding, adresă necunoscută și receiver UDP izolat.

## Etapa 3 — Playback engine

- Adaugă cache A/B per profil, grupuri exclusive și independente, no-op la valori identice, Person cu timer/revenire, coadă cu last pending, STOP cancel, resync și starea necunoscută la startup.
- Nu reface simplificat controllerul pe funcție fără teste de secvență. Fiecare group își serializează comenzile.
- DoD: teste pentru secvențele exact ordonate, switch între profile în grup, independența grupurilor, timer, pending replace, STOP, fail/uncertain și restart fără comandă automată.

## Etapa 4 — Bridge HTTP și UI OSCon

- Expune rutele/protocolul din `plasma-protocol.md`, cu token/origin/Host, body/time limits, responses versionate și service lifecycle.
- Creează pagini Status, Settings, Template-uri și Diagnostic prin preload sigur.
- DoD: teste auth/CORS/Host, rute și payloaduri invalide, replay command ID, coadă și status; UI afișează clar `UNKNOWN`, `LOCAL/UNCONFIRMED`, pending și `NEEDS_RESYNC`.

## Etapa 5 — Plumbing și UI Plasma

- Adaugă settings globale Plasma pentru endpoint/token, persistă tokenul criptat și expune-l browserului numai autentificat, fără cache/log.
- Configurează originea Plasma în OSCon. Integrează API-ul în cardurile MOS din workspace și timeline; conectare fără autoplay, editare valori, PLAY/STOP explicit și stare polling cu timeout fără retry.
- DoD: tests controller/resource/form pentru acces, token masking/encryption/no-store, explicit PLAY/STOP, payload exact și handling de timeout/queued/superseded. Build frontend.

## Etapa 6 — Corecții MOS și compatibilitate refresh

- Persistă separat overrides locale MOS. Folosește o identitate stabilă opacă derivată pe server din identitatea sursei și câmp, nu din valoarea curentă. Returnează override aplicat în UI împreună cu restore imported value.
- La refresh, reaplică override numai dacă obiectul și câmpul se potrivesc; păstrează override-urile orfane inactive. Nu modifica sursa MOS/ENPS/snapshotul și nu folosi match aproximativ.
- DoD: testele MOS resource/API pentru persistare/reset/conflict de versiune, refresh ENPS/HTM, obiect/câmp lipsă, corecții orfane, identitate schimbată și timeline în ordinea sursei.
- În aceeași etapă actualizează documentația Plasma, indexul Codex, resource types și testele relevante fără a schimba contractele ENPS nelegate.

## Etapa 7 — Release și acceptanță pe stația reală

- Configurează installer Windows x64, fără publish/update auto, verifică paths/output și runtime settings după instalare.
- Rulează `npm run test:unit`, typecheck și build în OSCon; în Plasma rulează testele Article MOS, ENPS import/web/refresh și `npm run build`.
- Verifică cu Chrome/Edge reale, origin HTTP LAN, firewall și permisiunea browserului; scrierea fișierelor Castalia, delayurile măsurate, A/B, profile conflict group, Person expirare și revenire la titlul pending.
- Acceptanța vizuală compară monitorul de output; sănătatea API și UDP send nu confirmă redarea.
- DoD: installerul pornește OSCon cu state unknown, profilele sunt verificate, operatorul poate resync/PLAY/STOP, iar cererile din Plasma nu controlează profile neconfigurate.

## Checklist per task

- Contractul și comportamentul așteptat sunt documentate.
- Testele sunt deterministe și nu trimit OSC către hardware.
- S-au verificat numai modulele/regiunile afectate, plus buildul cerut de strat.
- Mesajele de UI și logurile nu expun secretul, corpuri MOS, conținuturi de fișiere sau căi care nu trebuie publicate.
- Starea raportată diferențiază procesarea locală de redarea confirmată.
