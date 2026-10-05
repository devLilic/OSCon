# Arhitectură și cerințe OSCon

## Scop

Implementarea curentă este [portul funcțional OSC-lab](osc-lab-port.md), confirmat de utilizator înaintea implementării complete a modelului MOS de mai jos. OSCon nu folosește SQLite; setările sunt fișiere locale, iar valorile salvate în dev devin defaults ale instalării de producție. Contractele de profil generic și editor Plasma descriu extensia planificată.

OSCon rulează ca aplicație Electron pe stația LiveBoard și primește intenții de grafică din editorul Plasma. Pentru fiecare profil configurat, validează parametrii, scrie valorile în sursele urmărite de template și trimite comenzile OSC corespunzătoare.

Prima versiune deservește o singură destinație LiveBoard, dar poate avea mai multe profiluri de template și mai multe grupuri de redare. Numele template-ului din MOS este cheia profilului Plasma; poate diferi de numele contentului folosit în comanda LiveBoard.

## Limitele MVP

MVP-ul include profiluri TXT și JSON, profile de tip titlu A/B, Person cu durată și revenire la titlu, un profil generic cu unul sau două buffere, pagini de stare, Settings, Template-uri și Diagnostic, API HTTP pentru Plasma și administrarea conexiunii din Plasma.

Fiecare profil declară explicit câmpurile MOS acceptate, destinația fiecărui câmp (fișier TXT ori cheie JSON), contenturile LiveBoard și grupul de redare. Nu deduce mapări precum „Titlu scurt” → kicker. OSCon nu acceptă căi de fișiere, adrese OSC sau comenzi arbitrare în payloadurile Plasma.

În afara MVP-ului: destinații LiveBoard multiple, feedback/ACK de redare, transmiterea imaginilor, pornire automată, tray și actualizare automată. Aplicația folosește fereastră obișnuită; închiderea ei oprește serviciul HTTP și nu trimite automat STOP la LiveBoard.

## Procese și granițe

- **Electron main** deține UDP/OSC, listener-ul HTTP, accesul la filesystem, setările, profilurile, coada, timerele și mașina de stări.
- **Preload** expune numai API-uri înguste și tipizate necesare paginilor locale.
- **Renderer** afișează starea și editează setări/profiluri. Nu primește Node.js, socket, acces la filesystem sau tokenurile LiveBoard.
- **Plasma** servește autentificat configurația OSCon și păstrează conexiunea globală. Browserul operatorului face cererile de comandă direct la OSCon.

Persistă setările OSCon într-un fișier dedicat din `userData`, cu validare de versiune și salvare prin fișier temporar și înlocuire. Setările corupte ori incompatibile trebuie semnalate clar; nu porni serviciul într-o configurație de comandă implicită neverificată. Oprește comenzile în timpul schimbării configurațiilor care influențează un profil activ.

## Identitate și configurare inițială

Identitate planificată: nume `OSCon`, package name `oscon`, app ID `ro.devlilic.oscon`; logare activă, i18n activ cu româna implicită. Database, licensing, auto-update și app protection rămân dezactivate pentru MVP. Actualizează metadatele installerului Windows x64 și lasă publicarea dezactivată.

Un operator alege interfața/adresa LAN pe care ascultă OSCon, verifică adresa afișată, configurează originea exactă Plasma și transmite adresa plus bearer token în Settings OSCon și în pagina de administrare Plasma. OSCon generează tokenul criptografic; UI-ul îl arată doar când operatorul îl regenerează sau îl dezvăluie intenționat. Documentează autorizarea firewallului Windows pentru portul configurat. Nu presupune că browserul poate accesa orice IP LAN dintr-o origine HTTP.

Valori inițiale inspirate din OSC-lab, care trebuie confirmate la configurarea reală:

| Setare | Implicit |
| --- | --- |
| Receiver OSC | `127.0.0.1:501` |
| Prefix OSC | `/lvb/control/` |
| Port HTTP OSCon | `47834` |
| Delay propagare | `250 ms` |
| Gap tranziție | `100 ms` |
| Durată Person | `5000 ms` |

Nu confunda receiverul UDP 501 cu senderul LiveBoard `localhost:601`. Nu afirma suport pentru feedback LiveBoard: modelul de referință confirmă trimiterea locală UDP numai.
