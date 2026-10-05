# OSCon — portarea funcțională OSC-lab

## Scop confirmat

La 4 octombrie 2026, utilizatorul a confirmat că prima intervenție este o copie funcțională a OSC-lab, cu UI/UX reorganizat și o pagină Settings. Instrumentele suplimentare și integrarea MOS/corecțiile Plasma vor urma separat. Roadmap-ul general rămâne un plan de extindere; acest port nu reprezintă implementarea tuturor etapelor lui.

Codul de referință este `C:\Projects\OSC-lab`. OSCon adaptează modulele de redare, sursele TXT/JSON, preview-ul local și testele lor. Proiectul OSC-lab și modificările sale locale sunt păstrate intacte. Numele interne `lab` ale modulelor sunt păstrate pentru trasabilitate.

## Organizarea aplicației

- **Status**: control Titlu și Person, editare explicită a textelor și acțiuni PLAY/STOP.
- **Settings**: surse TXT/JSON, content names, delay de propagare, gap de tranziție, durată Person, receiver OSC și conexiune browser.
- **Diagnostic**: starea locală, bufferele, resync manual și jurnalul etapelor.
- **Preview**: fereastră separată cu simularea locală a textului activ; nu reprezintă feedback de la LiveBoard.

Se păstrează secvențele verificate din OSC-lab: scriere buffer ascuns → delay → RESUME anterior → gap → PLAY nou; Person suspendă titlul și revine la acesta la expirare sau STOP. În acest port rămâne blocarea comenzilor pe durata Person, ca în OSC-lab. Coada last-pending, grupurile generice și mapările MOS configurabile din roadmap nu sunt încă implementate.

La pornire starea este `UNKNOWN`, fără comenzi automate. Operatorul verifică LiveBoard și folosește STOP ori resync înainte de PLAY. Închiderea aplicației închide listener-ul HTTP, socketul UDP și timerele, fără STOP automat.

## Configurare și limite

Datele OSCon sunt separate de cele ale OSC-lab. Sursele inițiale de demonstrație se creează în `userData/output`, iar operatorul poate selecta fișierele TXT reale urmărite de CastaliaCG în Settings. Setările surselor și ale conexiunii sunt validate și înlocuite prin fișiere temporare. Fișierele JSON existente sunt păstrate și actualizate doar în cheile cunoscute.

Receiverul inițial este `127.0.0.1:501`, prefixul `/lvb/control/`, iar portul HTTP OSCon este `47834`. Senderul LiveBoard `localhost:601` nu este receiverul OSC. API-ul browserului este dezactivat până la confirmarea configurației în Settings. Tokenul nu este inclus în snapshoturi ori în răspunsul obișnuit de stare; este dezvăluit sau regenerat explicit.

API-ul portat folosește contractul de preseturi OSC-lab (`itemId` și `fields` pentru PLAY, `template` pentru STOP). Nu este API-ul MOS generic `{commandId, template, params, source}` din roadmap și nu trebuie conectat automat la editorul Plasma. Host, Origin exact, Bearer token, limitele corpului și timpul de citire sunt verificate înaintea comenzilor.

Pagina Plasma existentă `/LLC/test` folosește încă endpoint-ul `127.0.0.1:47833` și identitatea `liveboard-lab-controller`. Nu a fost modificată în acest port; identitatea OSCon este `oscon`, iar endpoint-ul inițial este `127.0.0.1:47834`. Adaptarea clientului Plasma și integrarea generică MOS rămân etape separate.

Pentru LAN, operatorul configurează adresa IPv4 locală exactă, originea Plasma exactă și portul, apoi autorizează acel port în firewallul Windows. Accesul Chrome/Edge și permisiunile rețelei locale trebuie verificate pe stația reală. Nu se dezactivează protecțiile browserului.

UDP send confirmă numai predarea locală a datagramei. Interfața și diagnosticul folosesc `LOCAL/UNCONFIRMED`; acceptanța redării, animațiilor și duratei Person necesită monitorul LiveBoard real.

## Defaults development → production

OSCon nu are SQLite: configurarea folosește fișiere JSON versionate, iar conținutul pentru LiveBoard folosește TXT/JSON.

În development, salvarea surselor actualizează `config/defaults/playback.json`, iar salvarea conexiunii actualizează `config/defaults/connection.json`, împreună cu setările locale. Erorile de scriere sunt afișate operatorului. Rotația tokenului nu schimbă defaults. `electron-builder` include cele două fișiere în `resources/defaults` din pachetul Windows.

La prima pornire, producția materializează defaults în fișierele locale `userData/lab-settings.json` și `userData/oscon-connection.json`. La pornirile următoare și la actualizări, configurarea locală are prioritate. Tokenul este creat pentru fiecare instalare și nu este inclus în pachet. Căile generate în output sunt portabile prin placeholder-ul `%OSCON_OUTPUT%`; căile externe Castalia rămân cele configurate explicit.

Dacă defaults sunt corupte sau incompatibile și nu există configurare locală validă, comenzile rămân blocate, iar OSCon nu creează automat o configurație locală din valori de rezervă. Settings rămâne disponibil pentru reparare explicită. O configurare locală validă continuă să aibă prioritate chiar dacă defaults din pachet sunt invalide.

Salvarea configurației și regenerarea tokenului rezervă controllerul pe durata operației. Dacă o salvare eșuează, rezervarea se păstrează până se termină restaurarea configurației; alte comenzi sau salvări nu pot intra în timpul restaurării. Schimbarea receiverului invalidează starea locală la `UNKNOWN`, fără comenzi OSC automate.

## Verificare

Se rulează `npm run test:unit`, `npx tsc --noEmit` și `npm run build`. Testele transportului folosesc numai receiver UDP izolat pe loopback. Testele controllerului folosesc transporturi simulate și verifică ordinea tranzițiilor; verificarea UI nu transmite comenzi către hardware.

`node scripts/smoke-oscon.mjs` verifică Status, Settings, Diagnostic și Preview în Electron, blocarea PLAY la startup, activarea explicită a API-ului, rotația tokenului și izolarea preview-ului. Cu `OSCON_SMOKE_CORRUPT_SETTINGS=1`, verifică și repararea fișierelor locale corupte prin salvarea valorilor afișate, fără editări artificiale și fără resetare prin regenerarea tokenului. `OSCON_EXECUTABLE` permite aceeași verificare pe executabilul Windows împachetat; `VITE_DEV_SERVER_URL` permite verificarea prin serverul development. Profilurile de test sunt în `artifacts/`, excluse din Git și din watcher-ul Vite, împreună cu output-ul `release/`.
