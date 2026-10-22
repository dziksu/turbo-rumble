# Docker i Coolify

Gra działa jako **jedna aplikacja Dockerfile, z jedną repliką**. Repozytorium: [dziksu/turbo-rumble](https://github.com/dziksu/turbo-rumble), gałąź `main`. Docelowy adres: **https://turborumble.rastwork.pl**. Wszystkie poniższe polecenia wykonuj z katalogu projektu.

## Lokalna próba obrazu

Wymagany jest działający Docker. Nie trzeba lokalnie instalować Node do samego uruchomienia kontenera.

```sh
docker compose up --build -d
docker compose ps
curl --fail http://localhost:4320/api/health
docker compose logs --tail=50 game
```

Domyślnie port jest dostępny tylko na tym komputerze. Aby grać telefonami w LAN:

```sh
HOST_BIND=0.0.0.0 PUBLIC_URL=http://ADRES_IP_KOMPUTERA:4320 docker compose up -d
```

Podstaw rzeczywisty adres IP. `PUBLIC_URL` jest pełnym originem bez ścieżki. QR na ekranie hosta musi wskazywać adres dostępny z telefonu. Zmienne w `.env` są automatycznie odczytywane przez Compose; lokalny `npm run dev` korzysta ze zmiennych wyeksportowanych przez shell.

```sh
GAME_URL=http://localhost:4320 npm run smoke
GAME_URL=http://localhost:4320 npm run playtest
docker compose stop
```

Smoke i playtest tworzą własne pokoje. Playtest prowadzi ośmiu klientów przez cały mecz, reconnect, przejęcie pada, pauzę hosta, wynik i rewanż. Nie wskazuj istniejącego pokoju osób grających na żywo. `docker compose down` zachowuje named volume; `down -v` usuwa wyniki i nie jest zwykłym krokiem aktualizacji.

## Ustawienia zasobu Coolify

1. Podłącz publiczne repozytorium `https://github.com/dziksu/turbo-rumble`, gałąź `main`, jako aplikację Turbo Rumble w środowisku produkcyjnym.
2. Build Pack: **Dockerfile**. Base Directory: katalog główny projektu. Dockerfile Location: `/Dockerfile`, target końcowy `runtime`. Nie podawaj osobnych komend build/start z Nixpacks.
3. Port aplikacji: **4317**. Proces już nasłuchuje na `0.0.0.0`. Domena: rzeczywista domena HTTPS skonfigurowana w DNS dla tego serwera. Przekazuj HTTP i WebSocket przez ten sam origin; Socket.IO działa pod `/socket.io/`.
4. Dodaj Persistent Storage typu volume, destination **`/app/data`**. Kontener pracuje jako użytkownik `node`, UID/GID **1000:1000**. Przy bind mount upewnij się, że ten użytkownik może zapisywać do katalogu. Nie montuj pustego volume na całym `/app`, bo ukryłby pliki aplikacji.
5. Ustaw poniższe zmienne jako runtime environment. Żadna nie jest sekretem kompilacji. Hasła i dane Coolify nie należą do obrazu ani repozytorium.
6. Ustaw jedną replikę i co najmniej 20 sekund czasu na zatrzymanie. Deployment uruchamiaj między meczami. Wyłącz nakładanie się starych i nowych instancji dla tego zasobu, jeżeli włączono rolling updates. Obie nie mogą obsługiwać tych samych pamięciowych pokoi.

| Zmienna            | Wartość                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `NODE_ENV`         | `production` (domyślnie w obrazie)                               |
| `HOST`             | `0.0.0.0` (domyślnie)                                            |
| `PORT`             | `4317` (zgodne z portem w Coolify)                               |
| `DATA_DIR`         | `/app/data` (zgodne z mountem)                                   |
| `PUBLIC_URL`       | np. `https://race.example.com`, zastąp prawdziwą domeną          |
| `TRUST_PROXY_HOPS` | `1` dla dokładnie jednego zaufanego proxy Traefik; `0` bez proxy |
| `MAX_ROOMS`        | `50` domyślnie; limit ochronny, nie wynik benchmarku             |

Jeśli przed Traefikiem stoi dodatkowy CDN/proxy, ustal rzeczywisty łańcuch i jego filtrowanie nagłówków. Nie ustawiaj automatycznie `trust proxy=true`; limit prób tworzenia i dołączania jest oparty o IP klienta. Aplikacja nie powinna być publicznie dostępna z pominięciem zaufanego proxy przy włączonym zaufaniu do forwarded headers.

## Cloudflare Tunnel w produkcji

- Publiczna domena: `turborumble.rastwork.pl`, z HTTPS kończonym na brzegu Cloudflare.
- Istniejący tunel `Collify-BEN-Linux` kieruje tę domenę bezpośrednio do `http://127.0.0.1:14317`. Mapowanie kontenera w Coolify: `127.0.0.1:14317:4317`. Port hosta jest dostępny tylko lokalnie; ta trasa nie przechodzi przez Traefik.
- Runtime: `PUBLIC_URL=https://turborumble.rastwork.pl`, `TRUST_PROXY_HOPS=1`, `DATA_DIR=/app/data`. `NODE_ENV=production` jest dostępne wyłącznie w runtime, aby build instalował zależności deweloperskie.
- Named volume dla `/app/data` zachowuje wyniki; nie skaluj aplikacji powyżej jednej instancji. Mapowanie stałego portu wymaga zatrzymania starego kontenera przed uruchomieniem nowego.
- `.dockerignore` wyklucza `docker-compose.yaml` generowany przez Coolify. Ten manifest służy do uruchamiania kontenera i nie powinien trafiać do źródeł sprawdzanych podczas budowania obrazu. Repozytoryjny `compose.yaml` pozostaje dostępny do lokalnych prób.

## Health i odbiór

Obraz zawiera Docker **HEALTHCHECK** wywołujący `GET /api/health` przez Node `fetch`, więc nie wymaga `curl` w kontenerze. Zgodnie z dokumentacją Coolify check z Dockerfile ma pierwszeństwo nad ustawieniami dashboardu. Zostaw go aktywnego. Jeżeli wybierzesz zamiast niego osobny check HTTP w Coolify, sprawdź wymaganie `curl`/`wget` w obrazie i dostosuj konfigurację świadomie.

Oczekiwana odpowiedź: HTTP 200 i `{ "ok": true, "game": "Turbo Rumble", "rooms": ... }`. Podczas zamykania aplikacja przestaje być gotowa. Sam health nie mierzy opóźnień rozgrywki ani obciążenia wielu pokoi.

Po wdrożeniu sprawdź stronę główną, utworzenie hosta, QR na fizycznym telefonie, gotowość i start, dźwięk odblokowany gestem, strzał i wynik. Uruchom `GAME_URL=https://TWOJA_DOMENA npm run smoke` w uzgodnionym środowisku. Sprawdź logi i brak błędów WebSocket. Restart kontrolny wykonaj po zakończeniu gry i upewnij się, że `/api/results` nadal pokazuje ten wynik. Pokoje sprzed restartu wygasają — to aktualne ograniczenie architektury.

## Backup działającej bazy

W terminalu kontenera aplikacji (lub odpowiednikiem `docker exec` dla rzeczywistej nazwy kontenera):

```sh
node dist-server/backup.js /app/data/backups/results-2026-10-21T180000.sqlite
```

Nazwa pliku musi być nowa. Program odmawia nadpisania istniejącego backupu i bazy źródłowej. Używa API SQLite online backup, sprawdza `PRAGMA integrity_check`, a następnie wypisuje ścieżkę. Nie wymaga zatrzymania meczu. `npm run backup -- /app/data/backups/UNIKALNA_NAZWA.sqlite` jest równoważne.

Skopiuj gotowy plik poza wolumen i poza serwer, np. funkcją pobierania pliku albo `docker cp`. Sam katalog `/app/data/backups` na tym samym dysku nie chroni przed awarią hosta. Nie kopiuj samego aktywnego `results.sqlite` bez WAL jako metody backupu.

## Przywracanie i rollback

1. Zatrzymaj aplikację i wszystkie procesy korzystające z tej bazy. Zachowaj kopię bieżącego całego katalogu danych przed zmianą.
2. Zweryfikuj backup: otwórz go SQLite i wykonaj `PRAGMA integrity_check` (wynik `ok`); backup utworzony powyższym skryptem jest już sprawdzany przy tworzeniu.
3. Zastąp `results.sqlite` zatwierdzoną kopią, **przy zatrzymanej aplikacji**. Usuń stare towarzyszące `results.sqlite-wal` i `results.sqlite-shm` dopiero po zachowaniu kopii starego katalogu. Ustaw właściciela plików na UID/GID 1000:1000.
4. Uruchom jedną instancję i sprawdź health oraz `/api/results`. Nie oczekuj powrotu aktywnych pokojów — nie są zapisywane.

Rollback kodu polega na ponownym uruchomieniu poprzedniego obrazu/revision w Coolify, **z tym samym volume**. Aktualny refaktor zachowuje istniejący schemat tabeli `matches`; nie wymaga migracji danych. Przed przyszłą zmianą schematu należy osobno ocenić zgodność starszego obrazu.

## Źródła ustawień

- [Coolify: Dockerfile](https://coolify.io/docs/applications/builds/dockerfile)
- [Coolify: Persistent Storage](https://coolify.io/docs/applications/configuration/persistent-storage)
- [Coolify: Health Checks](https://coolify.io/docs/applications/configuration/health-checks)
- [Coolify: Build and Deployment Model](https://coolify.io/docs/core/build-deployment-model)
- [Express: Behind Proxies](https://expressjs.com/en/guide/behind-proxies/)
- [Node 24: SQLite backup](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
