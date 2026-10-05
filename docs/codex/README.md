# OSCon — documentație Codex

OSCon este un intermediar desktop între editorul Plasma și template-urile LiveBoard. Documentele de aici descriu arhitectura și ordinea de implementare; trebuie citite și respectate când începe dezvoltarea.

Scopul curent confirmat de utilizator este portarea funcțională a OSC-lab, cu UI/UX reorganizat și Settings. Vezi [portarea OSC-lab și limitele implementării curente](osc-lab-port.md). Roadmap-ul complet MOS/Plasma descrie extinderile ulterioare și nu este integral implementat în acest port.

Portul este implementat și verificat pe 5 octombrie 2026: 184 de teste, build Windows x64 și verificări UI în development și în executabilul împachetat. Rezultatele și lucrările rămase sunt consemnate în [starea curentă din roadmap](roadmap.md#portul-osc-lab--starea-curentă).

## Documente

- [Portarea OSC-lab](osc-lab-port.md) — funcționalitatea actuală, Settings, API de preseturi și valorile implicite dev/prod.
- [Arhitectură și cerințe](architecture.md) — scop, limite, rolurile Electron și Plasma și cerințele funcționale confirmate.
- [Profiluri, date și tranziții](profiles-and-playback.md) — TXT/JSON, parametri MOS, buffere A/B, grupuri, temporizări, Person, coadă și resync.
- [Protocol Plasma–OSCon](plasma-protocol.md) — adrese, payloaduri, autentificare, stare, răspunsuri și protecția conexiunii LAN.
- [Roadmap și taskuri](roadmap.md) — ordinea etapelor, dependențe, Definition of Done și verificări.
- [Referință OSC-lab](osc-lab-reference.md) — comportamentele și setările observate în aplicația de laborator, inclusiv limitele confirmării OSC.

## Reguli pentru implementare

Lucrul este împărțit pe etape mici și secvențiale. Începe cu inițializarea proiectului și verificarea bazei; nu activa module starter doar pentru că există. Păstrează granița main/preload/renderer, contractele tipizate și regulile de securitate Electron. Adaugă teste logice pentru comportamentele implementate și execută verificările din taskul curent înainte de etapa următoare.

Nu trimite comenzi către un LiveBoard real în teste automate. Pentru OSC folosește un receiver UDP izolat pe loopback. O trimitere UDP reușită confirmă numai predarea locală a datagramei, nu citirea sursei sau redarea pe ecran.

Nu modifica proiectul OSC-lab pentru a implementa OSCon. Tratează-l ca referință și păstrează orice modificări locale necomise din acel proiect. În Plasma, păstrează fluxurile ENPS și HTM; citește instrucțiunile și documentația lor înainte de orice editare în fișierele protejate.
