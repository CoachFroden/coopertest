# Cooper 12 – Samnanger G14

Mobiltilpasset Cooper-test for trenerbruk.

## Testflyt

1. Velg spillere.
2. 3–2–1-start, alle starter samtidig.
3. Trykk spillerens kort ved hver passering av start/mål. Ett trykk = 400 m.
4. Ved 12:00 går et kraftig sluttsignal: **STOPP – STÅ I RO**.
5. Registrer siste del av runden med 0 / 100 / 200 / 300 m.
6. Resultatet lagres i Firestore med PB, historikk og utviklingsgraf.

## Praktiske sikkerhetsfunksjoner

- Fast plassering av spillerknapper under testen.
- Global «angre siste» og individuell −1 runde.
- Kort sperre mot utilsiktet dobbeltrykk.
- Wake Lock når støttet.
- Lokal sikkerhetskopi av aktiv test.
- Testmodus uten permanent lagring.
- DNF-støtte.

## Firebase

Appen bruker samme Firebase-prosjekt og e-post/passord-innlogging som CoachTool.
Firestore-samlinger:

- `cooperTests`
- `cooperConfig/team`

Se `firestore-rules-snippet.txt` for nødvendige regler.
