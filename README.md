# Turbo Rumble

Przeglądarkowa gra wyścigowa dla 2–8 osób: host pokazuje tor 3D na komputerze lub TV, a telefony dołączają kodem/QR i działają jako pady. Jest też klawiatura oraz boty. Projekt jest niezależny od Rachel.

## Uruchomienie

Node **24** i npm:

```sh
npm ci
npm run dev
```

Otwórz `http://localhost:4317`. Telefony w tej samej sieci korzystają z adresu LAN pokazanego w terminalu i kodu/QR na ekranie hosta. `localhost` na telefonie nie wskazuje komputera. `PUBLIC_URL` pozwala jawnie ustawić publiczny origin dla QR.

```sh
npm run check
npm run build
npm start
```

`check` obejmuje strict TypeScript, ESLint, formatowanie i testy. Build tworzy `dist/` oraz `dist-server/`; start używa zbudowanej aplikacji. Port, katalog danych i proxy konfiguruje się zmiennymi opisanymi w [instrukcji Coolify](docs/COOLIFY.md).

Docker bez lokalnego Node:

```sh
docker compose up --build -d
```

Podgląd: `http://localhost:4320`. Domyślnie tylko na komputerze; wariant LAN i dokładne ustawienia produkcyjne znajdują się w [docs/COOLIFY.md](docs/COOLIFY.md). **Produkcja: jedna replika, trwały wolumen `/app/data`, port 4317.**

## Rozgrywka

- Trzy mapy: Sundown Circuit XL (pustynia), Timber Run (las, szerokie ścieżki, fizyczne kłody i dwie rzeki) oraz Aloha Inferno (hawajski wulkan, palmy i dwie przeprawy nad lawą). Nowe mapy mają realne luki w nawierzchni i skocznie na całą szerokość drogi.
- Pierwszy dołączający człowiek zostaje administratorem; na padzie otwiera „Ustawienia spotkania”. Zmiana zasad cofa gotowość. Gdy wszyscy potwierdzą gotowość (minimum 2 auta), gra automatycznie odlicza 5 sekund. Cofnięcie gotowości, utrata połączenia lub nowy gracz anuluje start.
- Zawieszenie czterech kół na natywnym kontrolerze Rapiera, fizyczny przechył i tłumienie lądowań. Automatyczny gaz, ręczne skręcanie. Przytrzymanie zakrętu powoduje drift, puszczenie/kontra odzyskuje przyczepność. Oba kierunki naraz hamują. Ludzie nie mają automatycznego prowadzenia po torze.
- Delikatna pomoc w doganianiu: od 6 metrów straty do lidera stopniowo rośnie bonus do prędkości, do +12% przy 14 metrach. Wygasa po dogonieniu stawki. Nie zużywa przedmiotu, nie daje efektów nitro i nie sumuje się z nim; działa jednakowo dla graczy i botów. Hamowanie, mróz, trafienie, lot lub jazda pod prąd wyłączają pomoc.
- Klawiatura: A/D lub strzałki lewo/prawo, spacja = przedmiot, strzałka w dół = hamulec.
- Nitro, rakieta, mina, mróz i impuls. Rapier obsługuje kolizje, fizyczne miny i impulsy wybuchów; pociski używają sweep, a stałe przeszkody mogą osłaniać przed wybuchem.
- Start z 5 punktami. Punktacja zależy od miejsca i liczby graczy; domyślnie wygrana przy 10 punktach lub wynik po trzech okrążeniach. Administrator wybiera 1–9 okrążeń i próg 6–50 punktów. Oddzielne tabele punktów podczas jazdy, po rundzie i na końcu.
- Dźwięk WebAudio, głośność/wyciszenie, ślady opon, dym, czarne ślady wybuchów i krótki camera shake z obsługą reduced motion.
- Reconnect pada zachowuje kierowcę. Otwarcie tej samej sesji w drugim oknie przejmuje sterowanie. Utrata hosta pauzuje mecz; powrót w ciągu 30 sekund wznawia go, później pokój wraca do lobby.

## Kod i narzędzia

Kod aplikacji, testy i skrypty są w TypeScript. [Architektura](docs/ARCHITEKTURA.md) opisuje granice modułów; [review/refaktor](docs/REVIEW-I-REFAKTOR.md) zawiera znalezione problemy i status poprawek. `AGENTS.md` oraz dwa skille w `.agents/skills/` pomagają kolejnym agentom dobrać pliki, zachować reguły gry i wykonać testy.

| Polecenie                                | Zastosowanie                                        |
| ---------------------------------------- | --------------------------------------------------- |
| `npm run dev`                            | Lokalny serwer i HMR                                |
| `npm run check`                          | Typy, lint, format i testy                          |
| `npm run format`                         | Formatowanie Prettier                               |
| `npm run build` / `npm start`            | Build / serwer produkcyjny                          |
| `npm run smoke`                          | Szybki test ośmiu klientów, reconnect i uprawnień   |
| `npm run playtest`                       | Pełny mecz ośmiu klientów sieciowych i zapis wyniku |
| `npm run backup -- /nowa/sciezka.sqlite` | Sprawdzona kopia online SQLite po buildzie          |

Skrypty sieciowe domyślnie łączą się z portem 4317. Inny adres: `GAME_URL=http://localhost:4320 npm run smoke`. Raport pełnego testu: `QA_REPORT=/tmp/report.json ... npm run playtest`. Testy tworzą własne pokoje. Deweloperskie `/handling-check`, `/audio-check` i `/map-check` służą do ręcznego sprawdzania jazdy i efektów, a ich routery są wyłączone w buildzie produkcyjnym.

## Dane i ograniczenia wdrożenia

SQLite zapisuje ostatnie wyniki meczów w `DATA_DIR/results.sqlite` w trybie WAL. Istniejący schemat jest zachowany. API `/api/results` zwraca ostatnich 12 meczów; to nie system kont i zweryfikowanych tożsamości.

Pokoje i aktywna symulacja są w pamięci. **Restart lub deploy kończy aktywne pokoje**, nawet przy zachowanym wolumenie. Nie uruchamiaj wielu replik i nie obiecuj zachowania sesji przy rolling deploy. Limit 50 pokojów jest zabezpieczeniem liczby obiektów, a nie potwierdzonym wynikiem testu obciążenia.

Do faktycznego wdrożenia potrzeba wybranego repozytorium, zasobu Coolify, domeny i wolumenu. Ten etap przygotowuje pliki i lokalnie sprawdza kontener; nie publikuje kodu ani nie zmienia serwera produkcyjnego.

## Zasoby i wcześniejsze materiały

Modele Kenney są bezpłatne na licencji CC0. Szczegóły i źródła: `public/credits.html` i pliki licencji w `public/assets/`. Dokumenty historyczne opisują kolejne etapy prototypu: [specyfikacja referencyjna](docs/SPECYFIKACJA-REFERENCYJNA.md), [mapa i fizyka](docs/MAPA-XL-I-FIZYKA.md), [ręczne sterowanie](docs/STEROWANIE-RECZNE.md), [drift i wybuchy](docs/JAZDA-DRIFT-I-WYBUCHY.md). Historyczne raporty pod `docs/qa/` nie zastępują weryfikacji aktualnego kodu.

Nowe automatyczne raporty i zrzuty QA pozostają lokalnie w `docs/qa/`; nie są częścią kolejnych commitów.
