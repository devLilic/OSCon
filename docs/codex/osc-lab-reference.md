# Referință: OSC-lab

OSC-lab (`C:\Projects\OSC-lab`) este aplicația de laborator care a probat LiveBoard. Utilizatorul a autorizat ulterior portarea codului său în starterul OSCon, cu UI/UX și Settings reorganizate. Folosește nucleul și testele existente pentru comportamentele confirmate. Păstrează toate modificările necomise existente în OSC-lab și nu îi schimba codul pentru a implementa OSCon. [Scopul portului curent](osc-lab-port.md) precedă extinderile generice din roadmap.

## Modelul observat

- Electron main deține UDP/OSC, sistemul de fișiere, controllerul și mașina de stări; rendererul folosește preload tipizat.
- Destinația UDP testată este receiverul LiveBoard `localhost:501`; prefixul `/lvb/control/`; comenzi folosite includ `/play`, `/stop`, `/resume`. Senderul `localhost:601` este direcția opusă și nu este destinația controllerului.
- LAB separă starea `headline` de starea `name`. Pentru titlu A/B, fiecare buffer are content name și pereche de fișiere kicker/title distincte. Person folosește două fișiere name/role.
- Delay-ul tipic pentru propagarea fișierelor este 250 ms; gap-ul Headline external TXT este 100 ms; Person revine la titlu după 5000 ms.
- Secvența headline TXT la înlocuire este: scriere buffer ascuns, delay, RESUME content anterior, gap, PLAY content nou. Person poate suspenda titlul, rula timerul și reda headline-ul memorat după timer.
- Fișierele sunt surse de date urmărite de CastaliaCG; scrierea lor nu dovedește când sunt reîncărcate de LiveBoard.
- Starea `LOCAL/UNCONFIRMED` este intenționată. Callback-ul socketului confirmă numai trimiterea datagramei locale, fără ACK de la template ori confirmare vizuală.

## Lecții aplicate în OSCon

Păstrează cache și buffer metadata separate per profil. Pregătește sursele înainte de OSC; nu trimite PLAY dacă scrierea eșuează. Tratează swap-ul/timeoutul cu rezultat ambiguu ca necesită resync și evită retry automat. Fă delay-urile vizibile și configurabile. Testează ordinea comenzilor cu mock transport și UDP receiver izolat.

Documentele primare pentru detaliile implementării din OSC-lab sunt `README.md`, `docs/DATASOURCE.md`, `docs/LAB_TECHNICAL.md`, `config/lab.ts`, `src/shared/lab/contracts.ts` și `electron/main/modules/lab/GraphicsController.ts`. Reconfirmă setările din LiveBoard-ul real înainte de acceptanță; nu lua sample content names drept configurația definitivă a operatorului.
