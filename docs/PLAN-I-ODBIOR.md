# Turbo Rumble 0.1 — plan i odbiór

Projekt: `/Users/benjaminrast/projects/turbo-rumble`. Osobna aplikacja, bez zależności od Rachel i AirConsole.

## Zrealizowane etapy

1. **Symulacja**: Rapier 3D, krok 20 ms, automatyczny gaz, pomoc prowadzenia wzdłuż toru, sterowanie linią jazdy, hamowanie dwoma kierunkami, kolizje, rampa i otwarte krawędzie.
2. **Przebieg gry**: jeden tor Sundown Circuit, wspólna kamera, eliminacje poza kadrem, powtarzane segmenty, start z 5 punktami, cel 10 punktów lub trzy okrążenia, wyniki i rewanż.
3. **Walka**: nitro, rakieta, mina z czasem uzbrojenia, mróz, impuls; jeden slot, złote punkty odbioru i czas odnowienia.
4. **Wspólna gra**: pokoje z kodem i QR, oddzielny ekran hosta i lekki pad w telefonie, 2–8 osób, gotowość, boty, klawiatura, powrót po utracie połączenia, pauza przy utracie hosta.
5. **Oprawa i gotowe zasoby**: Three.js, modele Kenney CC0, lokalne fonty, prosty dźwięk proceduralny, pionowy i poziomy pad.
6. **Dane i weryfikacja**: wyniki w SQLite, testy fizyki i zasad oraz rzeczywiste połączenia Socket.IO.

## Odbiór 21 października 2026

- `npm test`: 16 testów przechodzi, w tym pełny mecz ośmiu botów.
- `npm run build`: klient i serwer budują się bez błędów TypeScript.
- `npm run smoke`: osiem niezależnych klientów; tworzenie pokoju, gotowość/start, ruch, uprawnienia hosta, przejęcie kontrolera, odrzucenie błędnego tokena i wznowienie hosta.
- Ten sam test sieciowy wykonano na zbudowanej wersji produkcyjnej.
- W przeglądarce sprawdzono stronę główną, szybki start, jazdę i użycie przedmiotu klawiaturą, wyniki, lobby, dołączenie przez adres LAN z QR, gotowość pada, użycie przedmiotu padem, eliminację i rewanż.
- Widoki pada sprawdzono przy 390×844 oraz 844×390. Test to przeglądarka w rozmiarze telefonu, nie osiem fizycznych urządzeń.
- Odczyt `/api/results` potwierdził trwały zapis rozegranych meczów.

## Parametry i kolejne kroki

Odtworzony jest rodzaj mechanik. Dokładne nieodzyskane parametry oryginału zastępują jawne wartości prototypu w `shared/simulation.ts`. Kod oraz tor są własne; wybrane modele mają licencję CC0.

Następny etap: wspólna sesja na prawdziwych telefonach Android/iOS i strojenie tempa, sterowania, kamery oraz częstości przedmiotów. Następnie puchary i kolejne tory, ekran historii wyników, a przed publicznym hostingiem pomiary opóźnień i obciążenia oraz HTTPS z WebSocket.

Ranking MMR, konta, wiele pucharów i publikacja w internecie nie należą do wersji 0.1. Bieżące uruchomienie oraz komendy odtworzenia są opisane w `README.md`.
