import { CHANGE_LOG_DAYS } from '../model/privacy';
import { localRepository } from '../model/storage';
import { askConfirm } from './ConfirmDialog';

interface Props {
  /** True when the API server is reachable (accounts and sharing exist). */
  serverAvailable: boolean;
  onClose: () => void;
}

/** Privacy notice (adatkezelési tájékoztató) plus the browser-side data controls. */
export function PrivacyDialog({ serverAvailable, onClose }: Props) {
  const clearLocal = async () => {
    if (
      !(await askConfirm(
        'A böngészőben tárolt családfa véglegesen törlődik erről az eszközről. Ha nincs feltöltve vagy exportálva, elveszik. Folytatod?',
        'Törlés',
      ))
    )
      return;
    localRepository.clear();
    window.location.href = window.location.pathname;
  };

  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog privacy-dialog" role="dialog" aria-label="Adatvédelem">
        <header className="panel-header">
          <h2>Adatvédelem</h2>
          <button className="icon" onClick={onClose} aria-label="Bezárás">
            ×
          </button>
        </header>
        <div className="privacy-text">
          <h3 className="section-title">Milyen adatokat tárolunk?</h3>
          <p>
            A családfában szereplő személyek nevét, nemét, születési és halálozási évét, a megjegyzéseket és a
            feltöltött fényképeket. Ezek a rokonaid személyes adatai is: élő személyekről csak annyit rögzíts, amennyi
            szükséges, és lehetőleg az ő beleegyezésükkel.
          </p>
          {serverAvailable && (
            <p>
              Fiók esetén az e-mail címedet, a nevedet, a jelszavad egyirányú (scrypt) lenyomatát, a bejelentkezések
              azonosítóit és a tájékoztató elfogadásának idejét.
            </p>
          )}

          <h3 className="section-title">Hol vannak az adatok?</h3>
          <p>
            Feltöltés nélkül a családfa csak ebben a böngészőben van (localStorage), sehova nem kerül el.
            {serverAvailable &&
              ' A „Megosztás” gombbal feltöltött fák az alkalmazás szerverén tárolódnak, és csak a tulajdonos, illetve a megosztott link birtokosai érik el.'}
          </p>

          {serverAvailable && (
            <>
              <h3 className="section-title">Ki láthatja?</h3>
              <p>
                A szerkesztői link birtokosa mindent lát és módosíthat. A csak olvasható link birtokosa elől a fa
                adatvédelmi beállításai szerint rejtve maradnak az élő személyek adatai, a fényképek vagy a
                megjegyzések, illetve azok a személyek, akiknél bekapcsoltad a „Rejtett” jelölést. A rejtett adatokat a
                szerver el sem küldi.
              </p>

              <h3 className="section-title">Meddig őrizzük?</h3>
              <p>
                A fákat és a fiókot addig, amíg nem törlöd őket. A szinkronizáláshoz használt változásnaplót{' '}
                {CHANGE_LOG_DAYS} napig, a bejelentkezéseket legfeljebb 30 napig.
              </p>
            </>
          )}

          <h3 className="section-title">Sütik és követés</h3>
          <p>
            {serverAvailable
              ? 'Egyetlen, a bejelentkezéshez szükséges munkamenet-sütit használunk. '
              : 'Nem használunk sütiket. '}
            Nincs hirdetés, analitika vagy harmadik féltől betöltött tartalom.
          </p>

          <h3 className="section-title">Jogaid</h3>
          <p>
            Bármikor letöltheted az adataidat (Exportálás, illetve a fiókban „Adataim letöltése”), javíthatod őket a
            szerkesztéssel, és törölheted a fákat vagy a teljes fiókodat. Panasszal a Nemzeti Adatvédelmi és
            Információszabadság Hatósághoz (NAIH) fordulhatsz.
          </p>
        </div>

        <h3 className="section-title">Ebben a böngészőben tárolt adatok</h3>
        <div className="button-row">
          <button className="danger" onClick={clearLocal}>
            Helyi családfa törlése
          </button>
        </div>
      </div>
    </div>
  );
}
