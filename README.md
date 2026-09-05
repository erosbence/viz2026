# VizKözösség

GitHub Pages-en futó, Firebase Firestore-adatbázist használó közösségi asszociációs szófelhő.

## Firebase beállítása

1. Hozz létre egy projektet a [Firebase Console-ban](https://console.firebase.google.com/).
2. A **Build → Firestore Database** oldalon hozz létre egy adatbázist.
3. A **Project settings → Your apps** részen adj hozzá egy webalkalmazást.
4. Másold a kapott `firebaseConfig` értékeit a `firebase-config.js` fájlba.
5. A **Firestore Database → Rules** lapon másold be a `firestore.rules` tartalmát, majd publikáld a szabályokat.

## GitHub Pages

1. A repository **Settings → Pages** oldalán a forrás legyen **GitHub Actions**.
2. A `main` ágra történő minden feltöltés automatikusan közzéteszi az oldalt.

## Adatmodell

Minden böngésző egyetlen dokumentumot hozhat létre a `responses` gyűjteményben. A dokumentum pontosan három, egyenként legfeljebb 40 karakteres kifejezést tartalmaz. Módosítás és törlés kliensoldalról nem engedélyezett.

## Helyi megnyitás

ES-modulok miatt egyszerű helyi webszerver szükséges, például:

```bash
python -m http.server 8080
```

Ezután nyisd meg a `http://localhost:8080` címet.
