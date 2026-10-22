# Turbo Rumble

Przeglądarkowe wyścigi dla **2–8 graczy**. Jeden ekran na komputerze lub TV, telefony jako pady. Trzy mapy, drift, rakiety, miny, nitro i podium na koniec meczu. Można też grać klawiaturą i z botami. Interfejs PL/EN.

## Uruchomienie

Wymagane: **Node.js 24** i npm.

```sh
npm ci
npm run dev
```

Otwórz **http://localhost:4317**, stwórz pokój i zeskanuj QR telefonem. W sieci lokalnej komputer i telefony muszą być w tej samej sieci Wi-Fi; telefon łączy się z adresem LAN hosta, nie z `localhost`.

## Jak grać

- Gaz jest automatyczny. Skręcaj lewo/prawo; oba przyciski naraz hamują.
- Przytrzymaj zakręt, aby wejść w drift. Zbieraj i używaj przedmiotów, zostań na torze i w kadrze.
- Klawiatura: **A/D** lub **←/→**, **spacja** używa przedmiotu, **↓** hamuje.
- Host lub pierwszy gracz ustala mapę i zasady. Gdy wszyscy są gotowi, startuje odliczanie.

## Rozwój i hosting

**TypeScript · Three.js · Rapier · Socket.IO · SQLite**

```sh
npm run check                 # typy, lint, formatowanie i testy
npm run build && npm start    # wersja produkcyjna
```

[Architektura](docs/ARCHITEKTURA.md) · [Docker / Coolify](docs/COOLIFY.md). Serwer wymaga jednej repliki; restart kończy aktywne pokoje. Wyniki są zapisywane w `DATA_DIR/results.sqlite`.

## Licencja i zasoby

Autorski kod i dokumentacja: **[PolyForm Noncommercial 1.0.0](LICENSE)**. Bez opłat do użytku niekomercyjnego, z możliwością modyfikowania i udostępniania na warunkach licencji. Licencja nie udziela zgody na komercjalizację kodu gry. Zachowaj [NOTICE](NOTICE) przy dystrybucji. To projekt z dostępnym kodem, z ograniczeniem użycia komercyjnego.

Zewnętrzne assety i biblioteki zachowują własne licencje; ograniczenie niekomercyjne projektu ich nie zastępuje. Modele Kenney: **CC0**. Nagranie poślizgu: **CC BY 3.0**, z wymaganym uznaniem autorstwa; [źródła audio](public/assets/audio/SOURCE.md). Filmowe tła menu są ilustracjami AI, nie zrzutami rozgrywki; [pochodzenie](public/assets/cinematics/SOURCE.md). Pozostałe źródła i licencje znajdziesz w ekranie `/credits` oraz w `public/assets/`.

**Autor:** Benjamin Rast · [GitHub](https://github.com/dziksu) · [rastwork.pl](https://rastwork.pl/)
