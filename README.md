# OSCon

OSCon este o aplicație desktop Windows care transmite mesaje OSC între editorul Plasma și template-urile LiveBoard. Starea de pornire a controlerului este necunoscută; transmiterea OSC nu confirmă afișarea conținutului pe LiveBoard.

## Dezvoltare

Prerequisite: Node.js 20+, npm 10+ și Git. În PowerShell, din directorul proiectului:

```powershell
npm install
npm run dev
```

Verificările locale sunt:

```powershell
npx tsc --noEmit
npm run test:unit
npm run build
```

`npm run build` produce interfața și pachetul Electron; pe Windows generează installer NSIS x64 în `release/0.1.0`. Configurația de release nu publică automat artefacte.

## Configurație inițială

Numele intern este `oscon`, numele produsului este `OSCon`, iar App ID-ul Windows este `ro.devlilic.oscon`. Limba implicită este româna, i18n și logging sunt active. Auto-update, app protection și licensing sunt inactive. OSCon nu folosește SQLite sau un serviciu de bază de date.

Interfața este împărțită în Status, Settings și Diagnostic, cu Preview într-o fereastră separată. La pornire, starea template-urilor este `UNKNOWN`; verifică LiveBoard și folosește STOP sau resync în Diagnostic înainte de PLAY. Configurarea și activarea API-ului Plasma se fac explicit în Settings. Contractul curent este cel cu preseturi OSC-lab; integrarea generică MOS din roadmap urmează separat.

## Setări development → production

Salvarea din Settings în development actualizează atât configurarea locală, cât și fișierele versionate `config/defaults/playback.json` și `config/defaults/connection.json`. Build-ul copiază aceste fișiere în `resources/defaults`; o instalare nouă pornește cu aceleași setări. Fișierele locale existente au prioritate și sunt păstrate la actualizarea aplicației.

Tokenul Bearer este generat separat pe fiecare instalare și nu este inclus în defaults. Căile de output administrate de OSCon sunt salvate în defaults cu `%OSCON_OUTPUT%`, apoi rezolvate către output-ul instalării curente. Căile TXT externe alese pentru Castalia sunt păstrate exact.

Configurarea locală este în directorul Electron `userData` (`%APPDATA%/oscon` în instalarea standard): `lab-settings.json`, `oscon-connection.json`, `output/` și `logs/`. Dacă un fișier este corupt sau incompatibil, comenzile sunt blocate până la salvarea unei configurații valide.

Verificarea UI izolată, fără comenzi către hardware, se poate rula după build-ul Vite:

```powershell
npx vite build
node scripts/smoke-oscon.mjs
```

Aplicația folosește Electron, React, TypeScript, Vite și Vitest. Codul privilegiat rămâne în Electron main, renderer-ul accesează funcții numai prin API-ul tipizat din preload, iar configul feature-urilor este în `config/`.

## Documentație pentru implementare

- [Indexul documentației Codex](docs/codex/README.md)
- [Portarea OSC-lab și limitele implementării curente](docs/codex/osc-lab-port.md)
- [Arhitectură și cerințe](docs/codex/architecture.md)
- [Profiluri, date și tranziții](docs/codex/profiles-and-playback.md)
- [Protocol Plasma–OSCon](docs/codex/plasma-protocol.md)
- [Roadmap și starea etapelor](docs/codex/roadmap.md)
- [Workflow-ul inițializării proiectului](docs/CODEX_PROJECT_INIT_WORKFLOW.md)
