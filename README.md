# famtree

Skálázható, interaktív családfa alkalmazás.

## Cél

- Családtagok és kapcsolataik (szülő, gyermek, házastárs) rögzítése és szerkesztése
- Interaktív, nagyítható és mozgatható családfa nézet
- Nagy, több ezer fős családfák gördülékeny kezelése

## Indítás

```bash
npm install
npm run server   # API szerver (http://localhost:3001), SQLite: data/famtree.db
npm run dev      # felület: http://localhost:5173 (az /api hívásokat a szerverre továbbítja)
npm test         # egység- és API-tesztek
```

Éles futtatás egy folyamatként (felület + API egy porton):

```bash
npm run build && npm start   # http://localhost:3001; PORT és DB_FILE környezeti változóval állítható
```

Szerver nélkül is működik: ilyenkor a fa csak a böngészőben tárolódik.

### Online változat (GitHub Pages)

A `main` ágra kerülő minden módosítás után a `.github/workflows/pages.yml` automatikusan közzéteszi a
felületet a https://akosorb.github.io/famtree/ címen. Ez a szerver nélküli, böngészőben tároló változat
(megosztás és fiókok nélkül). Egyszeri beállítás: Settings → Pages → Source: „GitHub Actions”.
Privát repóhoz a GitHub Pages fizetős csomagot (GitHub Pro) igényel; nyilvános repóval ingyenes.

## Funkciók (prototípus)

- **Interaktív nézet:** egérgörgővel nagyítás, húzással mozgatás, érintőképernyőn is.
- **Szerkesztés:** személyre kattintva oldalpanel nyílik: adatok módosítása, szülő / pár / gyermek
  hozzáadása új vagy meglévő személyként, törlés.
- **Fénykép:** személyenként feltölthető; négyzetesre vágva, 256 px-re kicsinyítve (kb. 5–20 KB) a személy
  adatai között tárolódik, és kis kerek képként megjelenik a kártyán is.
- **Keresés:** a felső keresőmezőből bárkire rá lehet ugrani.
- **Rokoni kapcsolat két személy között:** a panel „Kapcsolat keresése másik személlyel” gombjával. A fán
  kiemelődik a legrövidebb összekötő út, mellette a lépések (apja, lánya, felesége…) és a rokonsági
  megnevezés (pl. unokatestvére, nagynénje, sógornője, 5. fokú oldalági rokona).
- **Visszavonás / újra:** Ctrl+Z, Ctrl+Y (vagy Ctrl+Shift+Z).
- **Szűkített nézet:** a kiválasztott személyből kiindulva 2, 3, 5 vagy az összes generáció:
  - „Kijelölt körül”: felmenők, leszármazottak, párok és testvérek;
  - „Felmenők”: csak az egyenes ági ősök (szülők, nagyszülők…);
  - „Utódok”: gyermekek, unokák… a párjaikkal;
  - „Felmenők és utódok”: a kettő együtt, testvérek nélkül.

  A személy adatlapján is választható (Körülötte / Felmenői / Utódai / Mindkettő). A ⊕ jelvény mutatja, kinek
  vannak rejtett rokonai (felmenő/utód nézetben csak a nézet irányában); rákattintva oda ugrik a nézet.
- **Családtörténet kártyák:** a „Történetek” gombbal nyíló panelen események, emlékek rögzíthetők (cím, időpont,
  helyszín, szöveg), és tetszőleges családtagok rendelhetők hozzájuk. A kártyák időrendben jelennek meg; egy kártyára
  kattintva a tagjai kiemelődnek a fán, és bármelyik tagból kiindulva megnyitható a felmenői vagy utódai nézet. A
  személy adatlapján látszanak a történetei. A csak olvasható linken nem látszik az a történet, amely „Rejtett”-nek
  van jelölve, amelynek bármelyik tagja rejtett, vagy ha a megjegyzések rejtve vannak. A GEDCOM export a
  történeteket nem tartalmazza, a JSON igen.
- **Mentés:** alapból a böngésző localStorage-ába; JSON és GEDCOM (.ged) export és import.
- **Szerveres tárolás és megosztás:** a „Megosztás” gombbal a fa feltölthető a szerverre. Ezután egy
  szerkesztői és egy csak olvasható linket kapsz. Több szerkesztő egyszerre is dolgozhat: a módosítások
  pár másodpercen belül megjelennek a többieknél.
- **Fiókok:** regisztráció és bejelentkezés e-mail címmel és jelszóval. Bejelentkezve a feltöltött fák a
  fiókhoz kerülnek („Saját családfáim” lista), a tulajdonos link nélkül is eléri őket, és bármikor új
  linket készíthet, amivel a régi szerkesztői vagy csak olvasható link megszűnik.
- **Adatvédelem:** a csak olvasható linken alapból rejtve maradnak az élő személyek (nincs halálozási év,
  és 100 évnél fiatalabb vagy ismeretlen a születési éve); a fényképek és a megjegyzések is elrejthetők, egy-egy
  személy pedig az adatlapján „Rejtett”-nek jelölhető. A szűrést a szerver végzi, a rejtett adat el sem jut a
  böngészőig. A 🔒 gomb az adatkezelési tájékoztatót és a helyi (böngészőben tárolt) fa törlését nyitja meg.
- **Fiók és adatok:** jelszócsere (a többi eszközön kijelentkeztet), kijelentkezés minden eszközről, minden adat
  letöltése egy JSON fájlban, a fiók és a hozzá tartozó fák végleges törlése. Regisztrációkor el kell fogadni a
  tájékoztatót; az elfogadás ideje tárolódik.
- **Mintaadatok:** kis mintacsalád, illetve 500 / 2000 / 5000 fős generált fa a teljesítmény kipróbálásához.

## Felépítés

```
src/
  model/      adatmodell és tiszta (immutábilis) műveletek
    types.ts       Person, Union, Story (családtörténet kártya), FamilyTree
    graph.ts       visszafelé mutató indexek (ki kinek a szülője, párja)
    operations.ts  hozzáadás, összekapcsolás, törlés, ellenőrzésekkel (pl. körkörös leszármazás)
    storage.ts     TreeRepository interfész + localStorage megvalósítás
    gedcom.ts      GEDCOM 5.5.1 import/export
    subtree.ts     személy köré szűkített részfa (körülötte / felmenők / utódok / mindkettő)
    relationship.ts  útkeresés két személy között, rokonsági megnevezés
    sample.ts      mintaadatok és nagy fa generátor
    photo.ts       feltöltött kép vágása, kicsinyítése
  layout/     elrendezés
    layout.ts      rétegzett (Sugiyama-jellegű) elrendezés
    spatialGrid.ts térbeli rács a látható elemek gyors lekérdezéséhez
  sync/       szinkronizálás a szerverrel
    changes.ts     rekordszintű változáscsomagok (diff/alkalmazás/ellenőrzés), kliens és szerver közös
    api.ts         REST kliens
    useServerSync.ts  feltöltés, lekérdezés, ütközéskezelés
  components/ React felület (TreeCanvas, PersonPanel, Toolbar, PersonPicker, ShareDialog)
server/       Express + SQLite (better-sqlite3) API
```

### Szerver és szinkronizálás

- Minden személy és családi egység külön sor az adatbázisban, így egy módosítás csak az érintett
  sorokat írja, és a hálózaton is csak a változás megy át, nem az egész fa.
- Minden fának verziószáma van. A kliens a saját verziójára hivatkozva küldi a változásait; ha közben
  más is módosított (409), letölti az azóta történt változásokat, ráteszi a sajátjait, és újraküldi.
  Ugyanazon rekord egyidejű szerkesztésénél az utolsó mentés nyer.
- Jogosultság két úton: a tulajdonos fiókjával (HttpOnly, SameSite munkamenet-süti), vagy kulccsal.
  A szerkesztői kulcsot a szerver csak hash-ként tárolja, a kulcs a link `#` utáni részében utazik, így nem
  kerül szervernaplóba.
- A jelszavak scrypt-tel, egyedi sóval hash-elve tárolódnak; a munkamenet-tokenek is csak hash-ként.
  A bejelentkezés IP-nként percenként 10 próbálkozásra korlátozott.
- HTTPS-t végző fordított proxy mögött állítsd be a `TRUST_PROXY=1` változót, hogy a süti `Secure` legyen.

### Biztonság

- Biztonsági fejlécek minden válaszon: szigorú Content-Security-Policy (csak saját forrásból töltött szkript és
  stílus, beágyazás tiltva), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`,
  HTTPS esetén HSTS; az API válaszai nem kerülnek gyorsítótárba. A statikus (GitHub Pages) változat ugyanezt a
  CSP-t `<meta>` címkében kapja meg.
- Más oldalról érkező módosító kéréseket (eltérő `Origin`) a szerver elutasítja (CSRF elleni védelem a
  SameSite süti mellett).
- Korlátok IP-nként: API 600 kérés/perc, bejelentkezés, regisztráció és fiókműveletek 10/perc, fafeltöltés 30/óra.
- A beérkező rekordokat a szerver ellenőrzi, és csak az ismert mezőket tárolja; az importált JSON fájlok is
  ellenőrzésen mennek át.
- Megőrzés: a szinkronizálási változásnapló 30 napig marad meg (ennél régebbi állapotról a kliens a teljes fát
  tölti újra), a lejárt munkamenetek óránként törlődnek.

### Adatmodell

A kapcsolatok nem a személyeken, hanem **családi egységeken (Union)** tárolódnak: egy egységben
1–2 partner és közös gyermekeik vannak. Így egy személynek lehet több párja (pl. újraházasodás),
gyermek pedig pontosan egy szülői egységhez tartozik. A modell független a felülettől, így később
változtatás nélkül átvihető szerveroldalra is.

### Skálázhatóság

- **Elrendezés:** generációk kiosztása bejárással, a párok egy blokkba kerülnek, a sorrendet
  baricentrikus söprések javítják (kevesebb vonalkeresztezés), a vízszintes pozíciókat váltakozó
  „szülők a gyerekek fölé / gyerekek a szülők alá” igazítás adja. 5000 főre kb. 70 ms.
- **Megjelenítés:** csak a képernyőn látható személyek és vonalak kerülnek a DOM-ba (térbeli rácsos
  szűrés), kis nagyításnál egyszerűsített rajzolás (szöveg nélkül).
- **Tárolás:** a `TreeRepository` interfész mögé később szerveres (pl. REST + adatbázis) tároló tehető.

### Következő lépések (ötletek)

- Elfelejtett jelszó (e-mail küldés), személyre szóló meghívás szerkesztőnek
- Valós idejű frissítés (WebSocket) az 5 másodperces lekérdezés helyett
- Canvas/WebGL megjelenítés nagyon kicsi nagyításnál, 10 000+ fős fákhoz
- Fényképek a történetekhez, helyszínek térképen
