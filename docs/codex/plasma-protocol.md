# API Plasma–OSCon

## Model de conexiune

OSCon ascultă pe o interfață/adresă LAN configurată de operator; destinația/portul și originile permise sunt configurabile. Portul inițial propus este `47834`, separat de LLC `47833`. Plasma trebuie să fie originea exactă permisă (schemă, host și port). Nu folosi wildcard CORS.

Pagina de administrare Plasma păstrează adresa și tokenul OSCon în setările globale existente; tokenul este criptat la persistare și mascat în formular. Setările sunt disponibile tuturor utilizatorilor autentificați, conform deciziei MVP. Un endpoint autentificat returnează datele necesare browserului cu `Cache-Control: no-store`; secretul nu apare în loguri sau HTML cache-uit. Browserul păstrează tokenul numai în memorie pe durata utilizării editorului.

Pagina editorului cere explicit starea/health la conectare; nu trimite comenzi doar prin deschiderea articolului ori alegerea obiectului MOS. Cererile de comandă folosesc HTTPS/HTTP potrivit originii și adresei OSCon configurate, Bearer Authorization, `credentials: omit`, `cache: no-store`, timeout configurabil și un `commandId` unic. La timeout, rezultatul e incert: recitește starea fără retry automat.

Browserul Chrome/Edge poate impune permisiuni de acces la rețeaua locală și reguli secure-context/mixed-content. Acceptanța din MVP vizează Plasma HTTP în LAN și verifică permisiunea/versiunea browserului efectiv. Documentează pașii de depanare; nu dezactiva protecțiile browserului și nu declara HTTP LAN funcțional fără test pe stația reală.

## Rute

| Metodă și rută | Scop |
| --- | --- |
| `GET /v1/health` | Identitate serviciu, versiune protocol, readiness și configurarea limitată a endpointului |
| `GET /v1/profiles` | Profilele active și numele de câmp acceptate; fără căi filesystem sau secrete |
| `GET /v1/state` | Starea locală per grup și operațiile pending/curente |
| `POST /v1/play` | `{ commandId, template, params, source }` |
| `POST /v1/stop` | `{ commandId, template }`; oprește grupul template-ului |

`template` este numele MOS acceptat de un singur profil. `params` este un obiect nume→șir, toate valorile fiind explicite, inclusiv cele goale. Refuză parametri necunoscuți, lipsă, valori non-string și profile inexistente. `source` poate conține numai identificatori Plasma necesari diagnosticului (articol și obiect), niciodată căi sau date de rutare.

Adaugă versionare la răspuns și readiness; nu presupune că un `200` de health înseamnă OSC disponibil. Răspunsul pentru comenzi distinge între `accepted`, `queued`, `superseded`, `completed locally`, `rejected` și `outcome uncertain`, cu starea locală relevantă și același `commandId`. `commandId` repetat pentru o comandă deja cunoscută nu o execută a doua oară cât există evidența în proces.

## Verificări HTTP

Main verifică metoda și ruta, limitele corpului/timpului, bearer tokenul în timp constant, Host, Origin exact și payloadul tipizat înainte de controller. Răspunsurile au JSON, `no-store`, antete CORS numai pentru originile aprobate și răspuns sigur la erori. Nu accepta requesturi de pe alt host/origin cu token valid. Nu expune config path ori valori de fișiere în `health/profiles/state`.

API-ul ascultă numai pe interfața configurată și trimite OSC numai către destinația LiveBoard configurată. Logurile nu conțin token, conținutul payloadului, date MOS sau corpuri brute. Răspunsul HTTP confirmă numai procesarea locală OSCon; UDP OSC nu furnizează dovada redării.
