# Profiluri, date și redare

## Contractul profilului

Un profil are un identificator local stabil, un nume MOS acceptat, un grup, un comportament (titlu A/B, Person temporar sau generic), content names pentru LiveBoard, parametrii acceptați și mapări explicite ale parametrilor către surse TXT sau JSON. Profilul, nu browserul, decide toate destinațiile de date.

Parametrii vin ca șiruri, inclusiv șiruri goale, cu diacritice păstrate. Mapările trebuie validate înainte de salvare și înainte de PLAY. Respinge configurații incomplete, contenturi duplicate și aceeași destinație de fișier/cheie mapată de profile diferite; în timpul unei tranziții, ambele grafici pot citi acea sursă. Căile locale trebuie să fie absolute și scriibile. Când o validare eșuează, nu scrie fișiere și nu trimite OSC.

## TXT și JSON

Scrie TXT în UTF-8 fără BOM și fără newline final. Înlocuiește fiecare fișier prin temp file în același folder și rename/replace. O pereche de fișiere poate eșua parțial; în acest caz nu trimite comanda OSC și invalidează bufferul pregătit. Nu promite atomicitate pentru perechi.

Pentru JSON, citește și parsează fișierul existent, modifică numai cheile configurate, păstrează cheile nemapate și scrie JSON-ul rezultat prin fișier temporar și înlocuire. La fișier absent/corupt, nu suprascrie cu valori inventate și nu trimite PLAY; arată eroarea diagnosticabilă.

## Dublu buffer și secvențe

Urmărește separat, per profil, ce valori au fost pregătite în A și B, bufferul activ, itemul MOS și starea locală. Nu confunda aceste cache-uri locale cu o confirmare LiveBoard. La prima pornire, starea este necunoscută și cere STOP sau resync manual înainte de o nouă redare.

### Titlu A/B

1. Alege bufferul ascuns.
2. Scrie toate valorile mapate în fișierele/cheile acelui buffer.
3. Așteaptă delay-ul de propagare.
4. Dacă exista un titlu anterior în același grup, trimite RESUME pentru contentul lui.
5. Așteaptă gap-ul de tranziție și trimite PLAY pentru contentul nou.

Un PLAY pe profilul deja activ cu exact aceleași valori este no-op. La schimbarea unui profil cu altul în același grup, păstrează metadata ambelor buffere; dacă profilul nou nu are conținut activ, utilizează bufferul lui inițial și respectă secvența de înlocuire pentru contentul anterior.

### Un singur buffer și generic

Pentru un profil single-buffer activ, scoate mai întâi contentul curent prin RESUME, așteaptă gap-ul, scrie valorile, așteaptă propagarea și trimite PLAY. Pentru un profil generic A/B aplică secvența double-buffer. Profilurile generic single-buffer folosesc secvența single-buffer.

### Person temporar

Person păstrează perechea nume/funcție ca parametri obișnuiți configurați în profil. Dacă un titlu este activ în grup, scrie perechea Person, așteaptă propagarea, suspendă titlul și apoi trimite PLAY Person. Memorează bufferul și valorile titlului necesare revenirii și pornește timerul configurat. La expirare, dacă există o comandă PLAY pending pentru grup, execută direct noul titlu; altfel reia titlul memorat. STOP Person golește pending-ul și revine anticipat la titlu, dacă exista unul. Verifică vizual că durata timerului corespunde animației reale.

## Grupuri, coadă și stări ambigue

Profilele aceluiași grup se înlocuiesc reciproc; grupurile distincte operează independent. Serializăm operațiile per grup.

Păstrează cel mult o singură comandă pending per grup. O comandă nouă înlocuiește pending-ul neexecutat anterior; snapshotul pending include valorile primite la acel moment. Nu întrerupe operația deja începută. STOP anulează pending-ul și este executat după operația curentă. La timeout, eroare de socket sau rezultat de rețea incert, nu relua automat: marchează grupul `NEEDS_RESYNC`, raportează rezultatul incert și suspendă pending-ul. STOP și resync manual recuperează operarea.

Stările afișate exprimă numai ce a procesat local OSCon (`OFF`, `PREPARING`, `ON_A`, `ON_B`, `PERSON_ACTIVE`, `BUSY`, `NEEDS_RESYNC`, pending). La închiderea/repornirea aplicației, nu persistă timerul ori pending-ul și nu emite comenzi automate. Marchează starea `UNKNOWN` până la verificarea de către operator.

Orice log diagnostic poate conține operation ID, profil, grup, etapă și durate. Nu include bearer tokenuri, valori MOS private sau conținutul fișierelor. Starea și logul nu trebuie să pretindă că UDP send a confirmat redarea.
