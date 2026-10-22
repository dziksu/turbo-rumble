# Ręczne sterowanie — 21.10.2026

Naprawiono odwrócony skręt w układzie współrzędnych symulacji. Ta sama poprawka obejmuje pad pionowy, poziomy i klawiaturę.

Gracze nie mają już pomocy śledzącej tor. Automatyczny gaz działa wzdłuż faktycznego ustawienia auta, przyczepność tłumi jego poślizg boczny, a przyciski obracają samochód. Puszczenie przycisku zatrzymuje skręcanie i pozostawia aktualny kierunek. Oba przyciski nadal hamują. Boty zachowują prowadzenie po torze.

Rakieta i mróz startują w kierunku nosa samochodu, mina spada za nim. Obrócenie telefonu i utrata widoczności resetują naciśnięte przyciski.

## Weryfikacja

- 54/54 testy symulacji, fizyki i dźwięku; w tym 11 nowych przypadków ręcznego sterowania i kierunku broni. Lewo/prawo sprawdzone w czterech miejscach toru z projekcją przez kamerę gry.
- TypeScript i produkcyjny build: poprawne.
- Smoke test: 8 niezależnych połączeń, ruch, autoryzacja, przejęcie pada i powrót hosta.
- Pełny mecz 8 klientów: poprawny wynik, zapis rankingu, ponowny mecz, wszystkie 5 broni. Klienci testowi aktywnie skręcają na podstawie błędu kierunku do punktu przed autem.
- Interfejs pada: prawdziwe zdarzenia przycisków w przeglądarce i pomiar obrotu w autorytatywnych snapshotach Socket.IO. Widok 390×844: lewo +51,05°, prawo −51,05°. Widok 844×390: lewo +51,05°, prawo -39,47°. Dodatnia rotacja Y odpowiada skrętowi w lewo w kamerze gry.
- Próby UI wykonano w przeglądarce ze zmienionym rozmiarem okna, bez fizycznego telefonu. Konsola pada bez błędów i ostrzeżeń.

Dowody: `qa/manual-steering-ui.json`, `qa/manual-steering-network.json`, `qa/pad-portrait-manual.png`, `qa/pad-landscape-manual.png`.

Po aktualizacji należy odświeżyć ekran hosta i pad, a dla pokoju utraconego podczas restartu serwera utworzyć nowy pokój.
