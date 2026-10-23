# famtree

Skálázható, interaktív családfa alkalmazás.

## Cél

- Családtagok és kapcsolataik (szülő, gyermek, házastárs) rögzítése és szerkesztése
- Interaktív, nagyítható és mozgatható családfa nézet
- Nagy, több ezer fős családfák gördülékeny kezelése

## Indítás

```bash
npm install
npm run dev      # fejlesztői szerver: http://localhost:5173
npm test         # egységtesztek
npm run build    # éles build a dist/ mappába
```

## Funkciók (prototípus)

- **Interaktív nézet:** egérgörgővel nagyítás, húzással mozgatás, érintőképernyőn is.
- **Szerkesztés:** személyre kattintva oldalpanel nyílik: adatok módosítása, szülő / pár / gyermek
  hozzáadása új vagy meglévő személyként, törlés.
- **Keresés:** a felső keresőmezőből bárkire rá lehet ugrani.
- **Visszavonás / újra:** Ctrl+Z, Ctrl+Y (vagy Ctrl+Shift+Z).
- **Szűkített nézet:** „Kijelölt körül ±N generáció”: csak a kiválasztott személy felmenői, leszármazottai,
  párjai és testvérei látszanak. A ⊕ jelvény mutatja, kinek vannak rejtett rokonai; rákattintva oda ugrik a nézet.
- **Mentés:** automatikusan a böngésző localStorage-ába; JSON és GEDCOM (.ged) export és import.
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
  components/ React felület (TreeCanvas, PersonPanel, Toolbar, PersonPicker)
```

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

- Szerveroldali tárolás, felhasználók és megosztás
- Canvas/WebGL megjelenítés nagyon kicsi nagyításnál, 10 000+ fős fákhoz
- Fényképek, események, helyszínek
