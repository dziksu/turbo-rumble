# Rapier: zawieszenie, drift i osiem aut — 22.10.2026

## Zakres

Natywny `DynamicRayCastVehicleController` Rapiera 0.19, cztery sprężyny i tłumiki, opony, progresywny skręt, drift tylnej osi, swobodny pitch/roll oraz ograniczone wspomaganie lądowania. Telefon zachowuje automatyczny gaz, dwa kierunki, hamulec pod oboma kierunkami i osobne użycie przedmiotu. Brak nowej zależności i brak zmiany geometrii map.

## Regresje i kompilacja

- `npm run check`: 209/209 testów, TypeScript, ESLint i Prettier przechodzą.
- `npm run build`: klient i oba entrypointy serwera przechodzą; fizyka i scenariusze diagnostyczne nie trafiają do produkcyjnego klienta.
- 32 udane przeskoki: po osiem ludzkich aut równocześnie przez każdą z czterech przepraw, w dwóch rzędach i czterech pasach, przy 19 m/s bez nitro. Szczyt lotu 4,48–4,49 m; każde auto odzyskuje kontakt i stabilizuje lądowanie. Maksymalne ugięcie około 7 cm.
- Czołowe zderzenia ośmiu samochodów na każdej z trzech map: 4/4/13 różnych par kontaktu, ograniczone impulsy, odzyskanie podparcia i skuteczne hamowanie przez 8/8 aut. Promienie opon nie trafiają w dachy rywali.
- Asymetryczny zrzut z 3,5 m, osobne ugięcie kół, wygaszenie odbić, reset i usunięcie kontrolerów WASM.
- Animacja zawieszenia wszystkich czterech rzeczywistych GLB, pauza, teleport i brak ruchu koła zapasowego SUV-a.
- Zachowane regresje ręcznego kierunku, obu skrętów, broni, min kontaktowych i ochrony właściciela, wybuchów, mrozu, nitro, punktacji, przepraw i doganiania bez hamowania lidera.

## Prawdziwe połączenia sieciowe

Izolowany serwer na porcie 4318, osobny `DATA_DIR=/private/tmp/turbo-rumble-rapier-qa`; żadna próba nie korzystała z aktywnego pokoju użytkownika. `scripts/playtest-network.ts` uruchamia osiem niezależnie uwierzytelnionych kontrolerów Socket.IO, wysyłających te same przyciski co telefon.

| Mapa             | Wynik | Migawki obserwatorów | Rundy | Zdarzenia kolizji |
| ---------------- | ----- | -------------------: | ----: | ----------------: |
| Sundown Junction | PASS  |                 5320 |     5 |                43 |
| Aloha Inferno    | PASS  |                 3555 |     3 |                 4 |
| Timber Run       | PASS  |                 3301 |     3 |                24 |

Na każdej mapie: wszystkie pięć broni, ruch, eliminacje, doganianie, odrzucenie dziewiątego gracza, nieuprawnionych poleceń i złych tokenów; reconnect, przejęcie pada, pauza po utracie hosta i wznowienie, zakończenie meczu, jeden zapis SQLite, rewanż i powrót do lobby.

Próba lasu dodatkowo walidowała zakres i skończoność wszystkich czterech wartości zawieszenia oraz kwaternionu w każdej migawce. Zaobserwowano lot i późniejszy kontakt u czterech kierowców, ze skokiem zawieszenia do 0,07 m. Kontroler sieciowy sam wybiera drogę; gwarancja skoku całej ósemki pochodzi z oddzielnych prób fizycznych opisanych wyżej.

Surowe raporty z tej sesji: `/private/tmp/turbo-rumble-rapier-desert.json`, `/private/tmp/turbo-rumble-rapier-volcano.json`, `/private/tmp/turbo-rumble-rapier-forest.json`. To pliki tymczasowe i mogą zostać usunięte przez system.

## Przeglądarka

Rzeczywisty renderer Three.js w `/handling-check`: widok hosta 1280×800, osiem aut nad rzeką, lądowanie w lesie i przy wulkanie, zbliżenie nadwozia i kół, odczyt 0/4 kontaktów w locie i 4/4 po powrocie. Dodatkowe scenariusze dostępne przyciskami „Skok ×8”, „Lądowanie ×8”, „Zderzenie ×8”. Brak błędów JS; biblioteka Rapiera wypisuje dotychczasowe ostrzeżenie o parametrach inicjalizacji.

Osobny pokój przeglądarkowy: dołączenie, gotowość, automatyczny start i rewanż z pionowego pada 390×844. Przyciski i wynik mieszczą się na ekranie. To emulowany rozmiar okna, nie test na ośmiu fizycznych telefonach ani pomiar opóźnienia Wi-Fi. Długie skręty i jednoczesne hamowanie są dodatkowo objęte testami fizyki i sterowaniem ośmiu klientów sieciowych.
