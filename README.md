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

## Funkciók (prototípus)

- **Interaktív nézet:** egérgörgővel nagyítás, húzással mozgatás, érintőképernyőn is.
- **Szerkesztés:** személyre kattintva oldalpanel nyílik: adatok módosítása, szülő / pár / gyermek
  hozzáadása új vagy meglévő személyként, törlés.
- **Keresés:** a felső keresőmezőből bárkire rá lehet ugrani.
- **Visszavonás / újra:** Ctrl+Z, Ctrl+Y (vagy Ctrl+Shift+Z).
- **Szűkített nézet:** „Kijelölt körül ±N generáció”: csak a kiválasztott személy felmenői, leszármazottai,
  párjai és testvérei látszanak. A ⊕ jelvény mutatja, kinek vannak rejtett rokonai; rákattintva oda ugrik a nézet.
- **Mentés:** alapból a böngésző localStorage-ába; JSON és GEDCOM (.ged) export és import.
- **Szerveres tárolás és megosztás:** a „Megosztás” gombbal a fa feltölthető a szerverre. Ezután egy
  szerkesztői és egy csak olvasható linket kapsz. Több szerkesztő egyszerre is dolgozhat: a módosítások
  pár másodpercen belül megjelennek a többieknél.
- **Fiókok:** regisztráció és bejelentkezés e-mail címmel és jelszóval. Bejelentkezve a feltöltött fák a
  fiókhoz kerülnek („Saját családfáim” lista), a tulajdonos link nélkül is eléri őket, és bármikor új
  linket készíthet, amivel a régi szerkesztői vagy csak olvasható link megszűnik.
- **Mintaadatok:** kis mintacsalád, illetve 500 / 2000 / 5000 fős generált fa a teljesítmény kipróbálásához.

## Felépítés

```
src/
  model/      adatmodell és tiszta (immutábilis) műveletek
    types.ts       Person, Union, FamilyTree
    graph.ts       visszafelé mutató indexek (ki kinek a szülője, párja)
    operations.ts  hozzáadás, összekapcsolás, törlés, ellenőrzésekkel (pl. körkörös leszármazás)
    storage.ts     TreeRepository interfész + localStorage megvalósítás
    gedcom.ts      GEDCOM 5.5.1 import/export
    subtree.ts     személy köré szűkített részfa
    sample.ts      mintaadatok és nagy fa generátor
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
- Fényképek, események, helyszínek
