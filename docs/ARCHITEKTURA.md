# Architektura Turbo Rumble

Stan po refaktorze TypeScript, 21.10.2026. Gra już przed tą zmianą używała TypeScript; uporządkowano moduły, typowanie sieci oraz walidację zamiast tworzyć drugi wariant gry.

## Granice odpowiedzialności

| Obszar                 | Pliki                                                                                   | Odpowiedzialność                                                             |
| ---------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Uruchomienie           | `server/index.ts`, `app.ts`, `config.ts`                                                | Konfiguracja, składanie zależności, start i asynchroniczne zamykanie         |
| HTTP                   | `server/http.ts`, `rate-limit.ts`                                                       | Pokoje, dołączanie, health/info/wyniki, limity per IP                        |
| Pokoje                 | `server/rooms.ts`                                                                       | Tokeny, sloty, rola hosta, fazy dopuszczające zmiany składu                  |
| Sieć                   | `server/realtime.ts`, `shared/protocol.ts`                                              | Typowane zdarzenia Socket.IO, runtime validation, przejęcie pada i reconnect |
| Pętla                  | `server/runtime.ts`, `shared/rules.ts`                                                  | Krok 20 ms, snapshot co drugi krok, zapis wyniku, TTL pokoju                 |
| Fizyka                 | `shared/simulation.ts`, `vehicle.ts`, `driving.ts`, `physics-utils.ts`, `entities.ts`   | Rapier, fazy wyścigu, dynamika jazdy, stan aut                               |
| Broń                   | `shared/weapons.ts`                                                                     | Miny fizyczne, sweep pocisków, osłona od wybuchów i impulsy                  |
| Geometria              | `shared/track.ts`, `client/track-visuals.ts`                                            | Wspólna fizyka toru i osobne, ciągłe powierzchnie widoczne                   |
| Widoki                 | `client/pages/`, `client/main.ts`                                                       | Osobne strony home/join/pad/host; mały router                                |
| Infrastruktura klienta | `client/core/`                                                                          | DOM, API/sesje, typowany socket, odświeżanie przycisków, ładowanie sceny     |
| Grafika i audio        | `client/scene.ts`, `resources.ts`, `wreck-appearance.ts`, `race-effects.ts`, `audio.ts` | Three.js, współdzielone modele, cząstki/ślady/shake, WebAudio                |
| Wyniki                 | `server/results-store.ts`, `backup.ts`, `scripts/backup.ts`                             | SQLite WAL, zapis idempotentny, kopia online z kontrolą integralności        |

## Przepływ rozgrywki

Host tworzy pokój przez HTTP i dostaje losowy token. Telefon dołącza kodem, dostaje token osobnego kierowcy i potwierdza gotowość przez Socket.IO. Tokeny pozostają po stronie klienta w localStorage; kod pokoju nie jest uprawnieniem hosta. QR zawiera wyłącznie publiczny adres dołączania i kod.

Telefon wysyła `left`, `right`, `seq` i `actionSeq` co około 33 ms oraz po zmianie przycisku. Serwer odrzuca niepoprawne pakiety, nieaktualne numery sekwencji i cofnięcie licznika przedmiotów. Przy reconnect licznik jest resetowany; przy przejęciu sesji poprzedni socket jest odłączany. Dane klienta nigdy nie ustawiają pozycji, prędkości, obrażeń ani punktów.

Rapier działa na serwerze w kroku 0,02 s. Jest to pętla oparta na zegarze Node, bez nadrabiania nieograniczonej liczby kroków po przeciążeniu. Przy dużym obciążeniu czas gry może zwalniać; maksymalna liczba pokoi nie jest deklaracją przetestowanej wydajności. Migawki trafiają do klientów co dwa kroki, a Three.js interpoluje grafikę lokalnie. Nazwy graczy w tabelach są wstawiane przez `textContent`.

`Race` zachowuje publiczny interfejs używany przez testy fizyki. Funkcje broni korzystają z tej samej instancji świata, bez drugiej symulacji. Człowiek sam skręca; automatyczny jest tylko gaz. Bot ma osobną pomoc w podążaniu po torze. Parametry progresywnego skrętu i driftu wyznacza `drivingControl`; fizyczne kontakty kół należą do `VehiclePhysics`.

## Pomoc w doganianiu

`shared/catch-up.ts` oblicza łagodny bonus na podstawie różnicy postępu na torze do aktualnego żywego lidera. Używa dystansu z uwzględnieniem okrążeń, a nie odległości w przestrzeni, dzięki czemu nie myli bliskich odcinków nawrotu. Od 6 m straty narasta krzywą smoothstep do pełnej wartości przy 10 m; maksymalny wzrost docelowej prędkości to 30%. Włączenie i wygaszenie są dodatkowo wygładzane w czasie; narastanie osiąga około 95% stałego celu w 0,5 s. Zwykła prędkość docelowa wynosi 22 m/s, pomoc daje najwyżej 28,6 m/s, a nitro 29,7 m/s. Są to cele modelu jazdy, nie gwarantowana prędkość po tarciu i kolizjach. Bonus nigdy nie obniża docelowej prędkości lidera.

Bonus jest osobnym stanem `Car.catchUp`, a migawka udostępnia rzeczywisty ułamek prędkości jako `catchUpBonus` (0–0,30). Nie ustawia `boosted`, nie generuje dźwięku ani płomieni nitro, nie zużywa broni. Nitro zastępuje pomoc, bez mnożenia bonusów. Pomoc jest zerowana podczas hamowania, mrozu, efektu trafienia, lotu, odłączenia i jazdy pod prąd, a także przy ustawianiu aut do nowej rundy. Przyspieszenie bazowe wynosi 15 m/s²; pomoc płynnie podnosi jego limit maksymalnie o 40%, do 21 m/s². Nitro ma osobny limit 24 m/s² i zastępuje oba bonusy. Pomoc nie zmienia sterowania, teleportacji, punktacji ani reguły eliminacji poza kadrem. Boty korzystają z tej samej docelowej prędkości co ludzie.

Progi dobrano przed tylną granicą kamery, która na badanych fragmentach toru wypada przy około 18 m straty. Testy na trzech mapach, dla ludzi i botów, porównują lidera z identycznie jadącym autem w symulacji, w której zamrożony rywal nie dostaje bonusu ani nie może dogonić lidera: jego prędkość i pozycja pozostają identyczne, podczas gdy auto z tyłu w normalnej symulacji rzeczywiście przyspiesza i zmniejsza dystans. Testy sieciowe zapisują szczyt bonusu i jego odbiorców.

## Zapis i restart

Zakończony mecz jest zapisywany raz pod UUID z `INSERT OR IGNORE`. Po sekundowym pokazaniu ostatniego trafienia podium pozostaje widoczne przez 5 sekund. Termin jest oparty o zegar symulacji serwera i przesyłany jako `seconds`, więc ponowne połączenie lub zmiana języka nie restartują odliczania. Pętla automatycznie przywraca cały pokój do lobby dopiero po zapisaniu wyniku w SQLite; zeruje gotowość ludzi, zachowuje skład, admina, ustawienia i sesje. Gracze ponownie potwierdzają gotowość przed kolejnym meczem. API pokazuje ostatnich 12 meczów. Po zatrzymaniu pętli zapis końcowy następuje przed zamknięciem Socket.IO; światy Rapier i SQLite są zwalniane dopiero po handlerach rozłączenia. `close()` jest idempotentne. SIGTERM ma 15-sekundowy limit procesu, a Compose 20-sekundowy okres zatrzymania.

Pokoje, tokeny, pozycje i aktywne mecze żyją w pamięci. Restart je usuwa. Wolumen przechowuje tylko zakończone wyniki. Obecna architektura wymaga jednej repliki; Redis adapter do Socket.IO sam nie rozwiązałby współdzielenia światów fizyki.

## Puste pokoje i ponowne połączenie

`Room.emptySince` liczy czas od rozłączenia ostatniego uwierzytelnionego socketu (telefonu lub ekranu hosta). Nowy pokój bez żadnego socketu jest pusty od utworzenia. Boty ani żądania HTTP nie przedłużają jego życia. Połączenie zeruje ten termin, a kolejne pełne rozłączenie rozpoczyna nowe 3 minuty; wiek meczu nie wpływa na czas na powrót.

`server/runtime.ts` pomija `Race.step` dla pustego pokoju we wszystkich fazach, również po zakończeniu meczu. Stoją auta, boty, pociski, przeszkody i zegar symulacji. Po 3 minutach pętla usuwa pokój przez `RoomRegistry.dispose`, zwalniając kontrolery pojazdów i świat Rapier. Zakończone wyniki nadal są zapisywane w SQLite i usunięcie pokoju ich nie kasuje.

W pustym pokoju zachowany jest zatrzymany stan gry i tokeny sesji. Powrót hosta przed wygaśnięciem wznawia grę; sam telefon czeka na ekran hosta. Gdy telefony pozostają połączone bez hosta, dotychczasowy limit 30 sekund przywraca lobby. Otwarty ekran hosta jest aktywnym połączeniem, nawet jeżeli na torze zostały same boty. Przejęcie pada przez nowy socket i zamknięcie tylko jednej z kilku kart hosta nie uruchamiają usuwania pokoju.

## Typowanie i utrzymanie

Kompilator działa z `strict`, kontrolą fallthrough, override i wielkości liter w ścieżkach. ESLint blokuje jawne `any` i nieużywane zmienne. Prettier formatuje aktualne źródła; historyczne protokoły QA nie są przepisywane. Typy eventów obowiązują po obu stronach połączenia, ale nie zastępują walidacji obcych danych.

Nie włączono `noUncheckedIndexedAccess` w tym refaktorze: tablice próbek toru i indeksy geometrii mają istniejące założenia wymagające osobnego audytu numerycznego. Nie zastępowano ich masowo operatorami `!`, które dawałyby pozorne bezpieczeństwo.

Najważniejsze ograniczenia przed większą premierą: brak odzyskania aktywnego meczu po restarcie, brak testu obciążenia wielu równoległych pokoi i brak stałych kont graczy. Ranking dotyczy wyników meczów oraz bieżącego pokoju, nie zweryfikowanej tożsamości użytkownika.

## Powierzchnie mapy

`client/track-visuals.ts` buduje wizualne krawężniki, boki podbudowy i barierki jako pasy prowadzone wzdłuż toru. Sąsiednie fragmenty mają wspólne krawędzie bez nakładających się płaskich ścian. Geometria fizyki w `shared/track.ts` pozostaje źródłem kolizji. Widoczny początek rampy ma niewielki odstęp od asfaltu; kształt rampy kolizyjnej jest zachowany. Kamera ma near plane 1 m zamiast 0,1 m, co poprawia precyzję głębi przy dalekim widoku. Ślady wybuchów są przycinane do powierzchni skierowanych ku górze i nie są rysowane na bokach ramp.

Deweloperskie `/map-check` daje stałe ujęcia wszystkich ramp, nawrotów i linii startu oraz możliwość dodania śladu wybuchu. Parametry `s` i `view` odtwarzają ujęcie, np. `/map-check?s=520.6&view=left`. Widok jest wyłączony z routingu produkcyjnego. Odbiór i zrzuty: [kontrola powierzchni](KONTROLA-POWIERZCHNI.md).

## Spalony wrak

Serwerowe `CarState.wrecked` oznacza fizyczny wrak po śmiertelnym wybuchu miny lub rakiety. `client/wreck-appearance.ts` nadaje takiemu autu matowy, czarny materiał i ukrywa wszystkie węzły kół, także koło zapasowe SUV-a. Nie zmienia materiałów źródłowego GLTF ani innych graczy. Widok działa również po dołączeniu do istniejącego wraku, bez oczekiwania na jednorazowe zdarzenie wybuchu.

Wrak zachowuje dotychczasowy lot, obrót oraz czas życia 70 kroków fizyki (1,4 s). Po odrodzeniu przywracane są oryginalne materiały i widoczność kół. Własny materiał wraku jest zwalniany przed usunięciem auta albo całej sceny; zasoby współdzielone nadal należą do źródłowych modeli. Włączenie nitro nie spala własnego auta. Bezpośredni kontakt rywala z płomieniem nitro również zostawia spalony wrak; zewnętrzna, nieśmiertelna część fali wybuchu nie spala auta.

W deweloperskim `/handling-check` przyciski „Zniszcz auto”, „Zbliżenie”, „Reset” oraz wybór jednego z czterech modeli odtwarzają efekt w prawdziwej symulacji i rendererze. Próba zniszczenia zatrzymuje symulację tuż po śmiertelnym trafieniu; „Wznów jazdę” pokazuje dalszy ruch wraku.

## Wiele map i ustawienia spotkania

`shared/maps.ts` zawiera katalog trzech map oraz `RaceSettings`: identyfikator mapy, limit 1–9 okrążeń i próg 6–50 punktów. `shared/track.ts` tworzy i buforuje geometrię osobno dla każdej mapy. Funkcje i stałe eksportowane bezpośrednio z modułu opisują wyłącznie domyślną pustynię i pozostają zgodne ze starymi testami. Kod rozgrywki korzysta z `race.track`, a renderer z `scene.track`; nie wolno przełączać globalnego, współdzielonego toru między pokojami.

Droga fizyczna oraz wizualna mają te same luki w miejscach przepraw. Leśne rzeki mają 8 m, lawa 10 m; każda skocznia ma 18 m długości i 3,6 m wysokości. Testy przeprowadzają zwykły samochód przez wszystkie cztery przeprawy środkiem i w pasach ±4 m przy aktualnej prędkości bazowej 22 m/s, z prawdziwym automatycznym gazem i bez nitro. Upadek do rzeki eliminuje, upadek w lawę pozostawia czarny wrak. Kłody są dynamicznymi cylindrami Rapier. `client/biomes.ts` buduje instancjonowany las, wodę, lawę i wulkan; palmy i auta wykorzystują lokalne modele Kenney CC0. `GameScene.setMap` zwalnia poprzednią scenerię i ślady, zachowując współdzielone modele samochodów.

Pierwszy człowiek z połączonym, uwierzytelnionym padem otrzymuje `race.adminId`; samo HTTP join nie rezerwuje roli, a bot nigdy nie jest administratorem. Własność wynika z uwierzytelnionego, aktualnego socketu pada, a nie pola podanego przez klienta. Usunięcie administratora przekazuje rolę następnemu połączonemu człowiekowi. Rozłączenie zachowuje sesję i rolę przez 30 sekund na reconnect. `Room.disconnectedSince` śledzi termin odłączenia, także dla sesji HTTP, które nigdy nie połączyły pada. Po 30 sekundach serwer usuwa auto i token, zwalnia slot oraz wybiera nowego połączonego admina; jeśli pozostają tylko boty lub odłączeni ludzie, admin jest pusty do połączenia człowieka. Powrót przed terminem anuluje usunięcie, a ponowne rozłączenie daje nowe 30 sekund. Przejęcie kontrolera nie rozpoczyna odliczania. Czyszczenie działa według zegara serwera w każdej fazie, również przed pominięciem symulacji pustego pokoju, i podczas uwierzytelniania odrzuca wygasły token bez oczekiwania na następny tick. Ekran hosta nadal może usunąć gracza w lobby ręcznie. Usuwanie w czasie wyścigu czyści również kolejki eliminacji; zakończone wyniki pozostają zachowane. Uwierzytelniony ekran hosta może również zmieniać mapę i zasady, niezależnie od dołączenia kierowcy. Pierwszy gracz zachowuje uprawnienia administracyjne na swoim aktualnym padzie; pozostali widzą ustawienia bez możliwości zmiany. To celowe rozszerzenie wcześniejszej zasady „tylko pierwszy gracz”, wymagane dla panelu lobby hosta.

Polecenie `settings` jest walidowane w `shared/protocol.ts`, a stosowane przez `RoomRegistry.command`. Zmiana mapy tworzy nowy świat Rapier, przenosi identyfikatory graczy i zwalnia stary świat. Każda zmiana ustawień cofa gotowość ludzi. Parametry są częścią każdej migawki, więc nazwa trasy i liczniki na hoście oraz padach są spójne.

`RoomRegistry.syncLobby` automatycznie rozpoczyna 250-krokowe odliczanie (5 sekund) przy minimum dwóch autach, gotowości wszystkich, przynajmniej jednym człowieku i podłączonym ekranie hosta. Zmiana gotowości lub rozłączenie anuluje odliczanie; nowy gracz również je anuluje. Odrzucona próba dołączenia do pełnego pokoju nie zmienia fazy. Ponowne polecenie startu podczas odliczania nie przesuwa terminu. W trakcie jazdy gotowość i ustawienia są zablokowane. Awaryjny limit czasu skaluje się z długością mapy i wybraną liczbą okrążeń; dziewięciu okrążeń nie ucina dawny limit trzech minut. Po zapisaniu wyniku serwer cofa gotowość ludzi, aby rewanż wymagał nowego potwierdzenia.

Podglądy: `/map-check?map=forest&s=174.2&view=chase` i `/map-check?map=volcano&s=210.6&view=chase`. Katalog map wybiera się też w samym podglądzie. Test sieciowy akceptuje `QA_MAP=forest` lub `QA_MAP=volcano`; nie używa pokoju graczy.

## Ekran wejściowy

`client/intro-scene.ts` renderuje wyłącznie dekoracyjną scenę menu: trzy lokalne modele Kenney, małą platformę i skocznię. Nie tworzy `Race`, świata Rapier ani połączeń Socket.IO. `client/intro-motion.ts` wyznacza ciągłą pętlę 16 sekund, z wolniejszym ruchem przy szczycie skoku i obrotem kamery. Widok zachowuje podstawowe akcje „Stwórz pokój” oraz „Dołącz”; próba klawiatury i informacje deweloperskie są usunięte z menu.

Scena respektuje `prefers-reduced-motion`, ma przycisk pauzy i zatrzymuje klatki, gdy karta jest ukryta lub animacja znika poza ekranem. `pagehide` odłącza obserwatory i zwalnia zasoby GPU, również jeśli modele doładują się po wyjściu ze strony. Błąd WebGL lub ładowania dekoracji nie blokuje tworzenia pokoju ani dołączania.

## Języki interfejsu

`client/i18n/messages.ts` zawiera słownik EN z polskimi kluczami w stylu gettext. Pierwsza wizyta używa angielskiego niezależnie od języka systemu; `turbo:language` pamięta jawny wybór EN/PL. Przełącznik jest w nagłówkach menu, hosta, dołączania, pada i licencji. Zmiana odbywa się w miejscu: nie przeładowuje strony, nie tworzy socketu ani nie zmienia gotowości i formularza ustawień. Karty tej samej przeglądarki synchronizują wybór przez zdarzenie `storage`; osobne telefony zachowują własny wybór.

`bindTranslations` wiąże wyłącznie znane, stałe węzły szablonu i atrybuty dostępności, przed dodaniem treści graczy. Nie obserwuje mutacji DOM i nie tłumaczy nazw graczy. Dynamiczne etykiety wywołują typowane `t()`; renderery hosta i pada odświeżają się po zmianie języka. `raceMessage` buduje komunikat zwycięzcy z publicznych wyników; błędy API i Socket.IO są tłumaczone przy wyświetlaniu. Nowy tekst interfejsu należy dodać do słownika. Podglądy deweloperskie zachowują własne techniczne opisy.

## Widoczne uzbrojenie

`client/weapon-models.ts` odpowiada za sylwetki rakiety, miny, mrozu, impulsu i nitro. `CarEquipment` mocuje je nad górną granicą konkretnego modelu, w grupie przechyłu auta. Korzysta tylko z `CarState.weapon` i `alive`, więc zużycie przedmiotu, eliminacja oraz dołączenie w trakcie rundy odtwarzają się z migawki. Nie dodaje kolizji ani zmian do modelu jazdy. Ładunek mrozu obraca się, a szczyt cewki delikatnie pulsuje; ograniczenie ruchu wyłącza te dekoracje.

Trzy modele z Kenney Blaster Kit 2.1 (CC0) są w `public/assets/weapons/`, razem z wymaganą teksturą i oryginalną licencją. Pocisk piankowy jest bazą rakiety, granat rdzeniem miny, blaster korpusem wyrzutni mrozu. Płetwy, głowica, kula mrozu, cewka, zbiorniki i mocowania są lokalną geometrią. Pojedyncze źródła modeli i ich tekstura są współdzielone; zmiana przedmiotu usuwa klona bez zwalniania jego zasobów. Usuwanie auta i pocisku zachowuje `WeaponModels.roots`; pełna scena zwalnia bibliotekę raz. Brak pobrania modelu uruchamia geometryczny zamiennik. Produkcja korzysta wyłącznie z lokalnych plików, bez CDN.

Deweloperskie `/equipment-check` pokazuje wszystkie pięć przedmiotów, zbliżenia na cztery karoserie oraz przyciski użycia i zniszczenia. Używa `Race` i rzeczywistego `GameScene`, bez pokoju użytkowników. Trasa nie jest dostępna w produkcji. Testy sprawdzają odczyt migawki, zużycie i śmierć oraz zachowanie współdzielonych zasobów po usunięciu auta lub pocisku.

## Zbieranie przedmiotów

Każde ustawienie auta na starcie, po rundzie, w lobby lub w rewanżu zeruje slot broni w `Race.place`. Jedynym przyznaniem przedmiotu w normalnej symulacji jest kontakt fizycznego collidera żywego auta z aktywnym kryształem. Serwer sprawdza `Collider.intersectsShape` z kulą o współdzielonym promieniu `PICKUP_RADIUS`, zamiast dawnego zasięgu przyciągania 2,2 m od środka auta. Typ broni jest losowany dopiero przy tym kontakcie; przedmiot znika na pięć sekund. Zajęty slot oraz nieaktywny kryształ nie przyznają ani nie zamieniają uzbrojenia. Ustawianie nowej siatki startowej omija również kryształy.

`client/pickup-visuals.ts` synchronizuje pozycję i widoczność każdego kryształu z każdą migawką. Identyfikatory są ponownie używane na innych mapach, więc sama obecność istniejącej grupy Three.js nie może zachowywać pozycji poprzedniej trasy. Kryształy nieobecne w nowej migawce są usuwane razem z zasobami. Regresje obejmują wszystkie trzy mapy, start ośmiu aut, czekanie bez kontaktu, mijanie obok, zebranie i odnowienie, rewanż oraz zmiany mapy w rendererze.

## Miny kontaktowe

Mina jest uzbrojona od chwili zrzucenia. `shared/weapons.ts` sprawdza kontakt jej fizycznego collidera z nadwoziem, z tolerancją 3 cm na rozdzielenie powierzchni przez solver, zamiast promienia od środka auta. Pierwsze trafienie usuwa ciało miny i wywołuje jeden wybuch. `MINE_OWNER_PROTECTION_TICKS` wynosi 150 kroków (3 sekundy aktywnej symulacji): właściciel nie uruchamia własnej miny ani nie otrzymuje od jej wybuchu eliminacji, impulsu lub efektu trafienia, również gdy odpali ją przeciwnik. Ochrona dotyczy wyłącznie tej miny; rakiety i miny innych graczy nadal działają. Po upływie 150 kroków własna mina również może zranić właściciela. Zwykła ochrona po odrodzeniu pozostaje zachowana.

## Mróz i moment pokazania wyników

`FROST_DURATION_TICKS` wydłuża spowolnienie po trafieniu lodem do 80 kroków (1,6 s). Koniec rundy nadal rozlicza punkty raz i zatrzymuje sterowanie od razu. Migawka `summaryAt` podaje serwerowy moment wyświetlenia podsumowania, 50 kroków (1 s) po zakończeniu rundy lub meczu. Przez tę sekundę fizyka wraków i efekty wybuchu pozostają widoczne. Host ukrywa oba rodzaje podsumowań, a pad zachowuje komunikat eliminacji i blokuje gotowość do upływu tego terminu. Opóźnienie nie zależy od zegara urządzenia, zmiany języka ani ponownego połączenia. Podsumowanie rundy zachowuje pełne 140 kroków czytelności po tej sekundzie; pauza zatrzymuje zegar symulacji, a lobby i rewanż zerują termin.

## Płomień nitro

`NITRO_EXHAUST` w `shared/rules.ts` określa zasięg 1,6 m za tylnym zderzakiem oraz promień 0,38 m. `shared/weapons.ts` sprawdza kontakt collidera rywala z krótką kapsułą Rapier ustawioną według rzeczywistej orientacji auta. Tylko aktywne nitro w fazie jazdy emituje ogień. Sam przedmiot w slocie, pomoc w doganianiu, pauza, wygasły dopalacz i wrak nie zadają obrażeń. Ochrona po odrodzeniu i nieruchome przeszkody zasłaniające ofiarę zatrzymują efekt. Potencjalne trafienia są zbierane przed eliminacją, aby jednoczesne spalenie dwóch aut nie zależało od kolejności slotów.

Trafiony samochód staje się fizycznym spalonym wrakiem na 70 kroków; dostaje niewielki impuls, efekt wybuchu i znika mu uzbrojenie w rendererze. Nitro nie uruchamia obszarowej eksplozji. `client/nitro-exhaust.ts` buduje krótki pomarańczowo-biały płomień według tych samych wymiarów. Ogień jest dzieckiem obracającego się modelu, znika po wygaśnięciu nitro i śmierci, a ograniczenie ruchu wyłącza migotanie. Deweloperskie `/handling-check` ma przycisk „Ogień nitro” odtwarzający kontakt i zatrzymujący scenę z widocznym wrakiem.

## Animacja kół

`client/car-wheels.ts` jest wspólną animacją wyścigu i menu. Rozpoznaje wyłącznie cztery węzły `wheel-(front|back)-(left|right)` jako koła jezdne; `wheel-back` SUV-a pozostaje nieruchomy, ale nadal znika razem z pozostałymi kołami spalonego wraku. Promień jest mierzony z geometrii po normalizacji rozmiaru konkretnego modelu. Obrót wynika z przemieszczenia wzdłuż osi auta: boczny poślizg nie napędza kół, cofnięcie odwraca obrót, teleport nie dodaje obrotów. W locie koła zachowują prędkość obrotową z chwili wybicia. Pauza zachowuje skręt kół, ich obrót oraz przechył nadwozia.

Modele Kenney są skierowane w +Z, a ich koła mają oś +X; dodatni obrót koła jest jazdą do przodu, dodatni skręt wokół +Y oznacza lewo. Tylna oś nie skręca. Moduł nie zmienia fizyki, kolizji ani zasobów GPU. Testy wczytują rzeczywistą geometrię czterech dostarczanych GLB bez tekstur i sprawdzają obie strony auta, skręt, cofanie, poślizg, lot, pauzę, wrak i odrodzenie. Menu korzysta z tego samego obrotu i nie kręci już opon wstecz. W `/handling-check` wybór „Koła: Lewo/Prawo” odtwarza krótki rzeczywisty skręt i zatrzymuje widok od przodu; „Prosto” resetuje próbę.

## Panel ustawień lobby

`client/room-settings.ts` renderuje wspólny wybór trzech tras z miniaturami rzeczywistej grafiki gry (`public/assets/maps/`), liczbą okrążeń i progiem punktów. Na hoście panel jest stale widoczny w lobby. Na padzie przycisk „Konfiguracja” otwiera pełnoekranowy dialog z tymi samymi kartami, zasadami i listą botów do dodawania lub usuwania. Gość ma przycisk „Trasa i zasady” z podglądem bez edycji. W lobby główną akcją pada jest zielony przycisk gotowości z licznikiem gotowych ludzi; nieaktywne sterowanie jest ukryte. Podczas odliczania konfiguracja zamyka się, a podczas jazdy gotowość i konfiguracja są niewidoczne. Po pokazaniu końcowych wyników wracają dla rewanżu. Błędy poleceń w dialogu pojawiają się w jego nagłówku, ponieważ zwykły toast poza top layer byłby zasłonięty. Host korzysta ze swojego tokenu hosta, bez dodawania ukrytego gracza ani socketu klawiatury. Zmiany map i pól są zapisywane automatycznie przez dotychczasowe walidowane polecenie `settings`. Klient oznacza wybór podczas zapisu, a następnie pokazuje potwierdzony stan z serwera; blokuje kontrolki na czas zapisu i nie nadpisuje wpisywanego progu punktów powtarzającymi się migawkami. Zmiana z telefonu odświeża również duży ekran. Normalni goście pozostają bez prawa zapisu, a odliczanie i wyścig nadal blokują edycję.

## Sundown Junction — przebudowana pustynia

Pierwsza mapa ma nową pętlę około 1114 m, asfalt zmiennej szerokości 16–34 m, rynek z fontanną, strefę sklepów i place serwisowe. `shared/desert-layout.ts` opisuje szerokości, położenie budynków/skał, dwa mosty i dokładne wycięcia kanionów. `trackAt(s).width` jest lokalną połową szerokości drogi; `ROAD_WIDTH` pozostaje bazową wartością zgodności. `roadGeometry` oraz krawężniki i barierki uwzględniają lokalną szerokość, dzięki czemu fizyka i obraz nie tworzą dwóch różnych torów.

Grunt poza asfaltem jest teraz rzeczywistą powierzchnią Rapier na wysokości −0,18 m. Wyjazd na pobocze nie powoduje automatycznej śmierci; nadal obowiązują granice kamery i upadek poniżej −3 m. Tylko dwa wycięte kaniony stanowią lokalne przepaście. Górny tor prowadzi po fizycznych pomostach z barierkami; dolne drogi serwisowe są dekoracją poza trasą wyścigu. Odejmowanie prostokątów kanionów od gruntu daje 16 trójkątów, a nie gęstą siatkę terenu. Barierki kolizyjne łączą rzeczywiste końce odcinków przy lokalnej szerokości, eliminując szczeliny po zewnętrznej stronie zakrętów.

25 budynków oraz skały mają stałe collidery. Ich grafika jest dopasowana do tych samych rozmiarów i orientacji przez `desertAssetMatrix`. Fontanna ma własny collider, a boty wybierają dwa pasy omijające wyspę; nie zmienia to ręcznego kierunku ludzi. `gridProgress` sprawdza stałe przeszkody, więc odrodzenie nie ustawia auta wewnątrz fontanny. Testy doganiania korzystają z wolnej prostej zamiast miejsca, w którym stoi teraz fontanna.

`client/desert-scenery.ts` buduje grunt, mosty, podpory, markizy, fontannę i parkingi oraz ładuje wybrane darmowe modele Kenney City Kit Suburban, City Kit Commercial i Nature Kit. Powtarzane modele korzystają z instancjonowania; źródła pozostają w ukrytej bibliotece należącej do danej scenerii, aby zasoby zostały zwolnione razem z nią. Spóźnione pobranie po zmianie mapy zwalnia model bez dodawania go do nowej sceny. Licencje i źródła pobrania są w `public/assets/desert/`, a ekran licencji zawiera odnośniki do paczek.

Deweloperskie `/map-check` ma pozycje rynku, placu serwisowego i obu mostów. Nowe regresje w `tests/desert-layout.test.ts` sprawdzają podparcie szerokich pasów i poboczy, brak niewidzialnej podłogi w kanionach, przejazdy po obu mostach, stałe kolizje obiektów, zależności lokalnych GLB, omijanie fontanny i bezpieczne odrodzenia. Las i wulkan zachowują własne definicje i luki do skoków.

Limit czasu wyścigu używa stałej referencji 900 m (`RACE_TIMEOUT_REFERENCE_METRES`), zamiast aktualnej długości pierwszej mapy. Dzięki temu jej przebudowa nie skraca czasu na okrążenia w lesie i przy wulkanie.

## Nagrania audio i muzyka

Dźwięk odtwarza wyłącznie ekran hosta. `client/audio-assets.ts` ładuje lokalne nagrania silnika, opon, zderzeń, wybuchów i broni oraz zapętlony „Pixel Sprinter” Zane Little. Każdy plik ma osobną ścieżkę błędu, a muzyka OGG ma kopię MP3 dla przeglądarek z innym zestawem dekoderów. Brak pobrania nie blokuje gry; sygnały interfejsu i zapasowe efekty nadal korzystają z syntezy Web Audio. Źródła, autorzy, modyfikacje i licencje są w `public/assets/audio/SOURCE.md` oraz na `/credits`. Odgłos opon jest na CC BY 3.0 i wymaga zachowania oznaczenia audible-edge (Tom Haigh) oraz qubodup; pozostałe pobrane nagrania są CC0.

`client/vehicle-audio.ts` prowadzi osobny głos dla maksymalnie ośmiu aut, z lekką różnicą wysokości, panoramą i tłumieniem odległości oraz normalizacją całej stawki. Prędkość steruje obrotami i wirtualnymi zmianami biegu, a nitro podnosi wysokość niezależnie. `tyreSlip` reaguje na rzeczywisty `slip`, prędkość i `grounded`; sam skręt, postój, lot i śmierć nie włączają pisku. Fazy inne niż jazda wyciszają silniki i opony.

`client/music-audio.ts` zachowuje pozycję zapętlonego utworu po wyciszeniu lub ukryciu karty. Kolejne migawki nie tworzą nowych źródeł ani nie restartują podkładu. `Sound` ma osobne poziomy efektów i muzyki, domyślnie ustawia muzykę na 8% i zachowuje jawnie zapisany wybór użytkownika, zapamiętuje preferencje, przycisza utwór przy odliczaniu, pauzie i ważnych efektach, a wspólny kompresor z zapasem poziomu ogranicza sumę głośnych zdarzeń. `client/audio-controls.ts` udostępnia te ustawienia w rozwijanym panelu MIX, z tłumaczeniami EN/PL. Dźwięk odblokowuje zwykła interakcja z ekranem hosta; respektujemy ograniczenia autoplay przeglądarki. Wyjście ze strony przerywa pobieranie i zwalnia graf audio.

`/audio-check` dekoduje rzeczywiście dostarczone pliki i renderuje je w `OfflineAudioContext`: efekty, normalny silnik i nitro, ciszę opon poza poślizgiem, wznowienie utworu, pełne wyciszenie, stereo oraz miks wielu aut i wybuchów. Testy Node weryfikują granice parametrów, telemetrię poślizgu i kompletność lokalnych plików.

## Rozbudowa Timber Run i Aloha Inferno

`shared/biome-layout.ts` opisuje poszerzenia polan i bazy, budynki, stałe przeszkody, podpory bram/łuków oraz po dwa ruchome ramiona na mapę. Las rozszerza drogę do 30 m, wulkan do 30 m; strefa obozu i wybrzeża mają do 26 m. `shared/terrain.ts` jest wspólnym odejmowaniem otworów od wypukłej powierzchni. Pustynia zachowuje dokładnie tę samą geometrię, las ma grunt −0,18 m i wycięte rzeki, a wulkan wielokątną wyspę i wycięte kanały lawy. Skocznie i długości luk pozostają zgodne z wcześniejszymi przejazdami przy normalnej prędkości. Wyjazd na pobocze eliminuje dopiero po wypadnięciu poza kamerę albo fizycznym upadku.

`Race.movingHazards` przechowuje kinematyczne ciała Rapier z prawdziwymi colliderami. `movingHazardPose` wyznacza ich obrót z `hazardTick` rosnącego tylko podczas jazdy; pauza, odliczanie i podsumowania nie obracają ramion. Reset przeszkód zeruje ich czas, bieżącą i następną pozycję. Migawki przekazują obroty przez istniejące `obstacles`, z identyfikatorami 1000–1001. Klient interpoluje autorytatywną pozycję; lokalny ruch ramion jest dozwolony wyłącznie w podglądzie bez migawki. Kłody pozostają dynamiczne i reagują na eksplozje; stałe zakotwiczone ramiona nie są odrzucane przez broń. Środkowy przejazd pozostaje wolny, a odrodzenia omijają pełną strefę zamachu.

`client/biome-scenery.ts` buduje drewniane domki, tartak, wieże, namioty, koła wodne, kaskadę, stacje geotermalne, chatki, bazaltowe kolumny, łuki, dym i dekoracyjne erupcje. Korzysta z własnej geometrii oraz istniejących lokalnych modeli Kenney Nature Kit. Woda, koła młyńskie, anteny i para korzystają z czasu migawki, więc pauza zatrzymuje dekoracje. Ograniczenie ruchu wyłącza dekoracyjne animacje, zachowując widoczność fizycznych ramion. Wszystkie zasoby należą do korzenia konkretnej mapy i są zwalniane podczas przełączania. Dekoracyjne gejzery nie dodają osobnych, niewidocznych stref obrażeń; prawdziwa lawa w przeprawach zachowuje serwerową eliminację.

`tests/biome-upgrade.test.ts` sprawdza podparcie poboczy i szerokich placów, brak niewidzialnej podłogi w wodzie/lawie, kierunek normalnych terenu, obrót i synchronizację ramion, niezależność pokoi, pauzę, reset, fizyczne odepchnięcie hamującego auta, bezpieczne odrodzenia oraz stałą liczbę obiektów po aktualizacjach scenerii. Podgląd `/map-check` ma pozycje TIMBER WORKS, RANGER CAMP, LAVA WORKS i PALM COAST.

## Zawieszenie i opony Rapiera

`shared/vehicle.ts` tworzy natywny `DynamicRayCastVehicleController` z czterema kołami dla każdego nadwozia (200 kg). Koła mają sprężyny, osobne tłumienie kompresji i odbicia oraz ograniczony skok. Silnik, hamulec i przyczepność działają przez impulsy w punktach kontaktu, więc w locie nie ma napędu od niewidocznej jezdni. Promienie pomijają nadwozia innych aut; kontakt karoserii nadal rozstrzyga solver Rapiera. Przechył i pochylenie są odblokowane, środek masy obniżony, a ograniczone impulsy stabilizujące ułatwiają lądowanie bez teleportowania auta i bez nadpisywania prędkości kątowej. W czasie odrzutu wyłączają się napęd i wspomaganie obrotu; wraki pozostają całkowicie fizyczne.

`shared/driving.ts` zamienia dwa przyciski na progresywny skręt przednich kół i płynnie narastający/zanikający poślizg tylnej osi. Kontra odzyskuje przyczepność, oba kierunki hamują. Po 0,4 s trzymania obu przycisków na ziemi przy prędkości poziomej do 0,8 m/s włącza się cofanie do 5 m/s, bez bonusu doganiania ani nitro. Wsteczny pozostaje aktywny do puszczenia przycisku, utraty podparcia lub trafienia; puszczenie przywraca automatyczny gaz do przodu. Reset rundy, rozłączenie i przejęcie pada zerują stan cofania. Wspomaganie yaw reaguje wyłącznie na wejście gracza; tylko boty wyznaczają kierunek z punktu na trasie. Puszczenie przycisku wygasza obrót w krótkim czasie, zamiast natychmiast zerować pęd. Doganianie korzysta z rzeczywistych kontaktów kół i nadal nie sumuje się z nitro.

Migawka wysyła `suspension` w metrach: przód lewy/prawy, tył lewy/prawy (dodatnie ugięcie). `CarWheels` przelicza podróż na lokalną skalę konkretnego GLB i interpoluje ją niezależnie od obrotu opony. Zapas SUV-a pozostaje nieruchomy. Pauza utrzymuje ugięcie; odrodzenie czyści stare kontakty i tworzy kontroler ponownie. Usunięcie auta zwalnia kontroler przed ciałem, a zamknięcie pokoju przed światem WASM. Produkcyjny klient nie pobiera fizyki Rapiera; nadal tylko interpoluje migawki.

`/handling-check` ma „Skok ×8”, „Lądowanie ×8” i „Zderzenie ×8” dla lasu/wulkanu oraz odczyt kontaktów i skoku zawieszenia. Scenariusze w `client/vehicle-scenarios.ts` używają rzeczywistej symulacji i są wycinane z produkcji. `tests/vehicle.test.ts` sprawdza asymetryczny zrzut, stabilizację po odbiciu, wspólne skoki ośmiu ludzi na wszystkich czterech przeprawach, czołowe kontakty ośmiu nadwozi na trzech mapach oraz cykl życia kontrolerów. Test małych skoczni celuje zgodnie z osią fizycznej rampy, ponieważ przed zakrętem styczna drogi ma inny kierunek. Testy skrętu kontrolują krótki, ograniczony powrót kierownicy oraz zachowanie ręcznego kierunku po ustaniu obrotu.

## Zasięg pocisków i impuls

`PROJECTILE_RANGE` w `shared/rules.ts` ustala maksymalny lot od wylotu lufy: 28 m dla rakiety, 24 m dla mrozu. Serwer liczy rzeczywiście przeleciany dystans w `Shot.travelled` i przycina ostatni sweep Rapiera do pozostałej długości. Ściana lub auto przed limitem rozstrzyga trafienie wcześniej; obiekt za limitem nie przedłuża lotu. Rakieta kończy lot rzeczywistym wybuchem, a mróz niebieskim rozbłyskiem; przekroczenie awaryjnego czasu życia również daje efekt. Pauza zatrzymuje lot. Reset i usunięcie pocisku nie detonują go ponownie. Licznik dystansu pozostaje wewnętrznym stanem serwera.

Każda detonacja rakiety przekazuje do `blast` identyfikator strzelającego: własny pocisk nie eliminuje, nie odrzuca, nie obraca i nie nakłada efektu trafienia na właściciela, również po podjechaniu do wybuchu na końcu lotu. To wykluczenie dla konkretnego pocisku; nie ustawia ogólnej nietykalności i nie osłabia rakiet ani min innych graczy. Trzysekundowa ochrona przed własną miną pozostaje osobną regułą.

`PULSE` zachowuje promień 8 m, ale daje 8–28 m/s radialnej zmiany prędkości, zależnie od odległości (wcześniej 0–11 m/s). Na 4 m wzrost to 18 zamiast 5,5 m/s. Podbicie wynosi 2,6 m/s, a ograniczenie przyczepności i napędu po trafieniu trwa 0,6 s, aby opony nie skasowały odrzutu od razu. Impuls nie dotyka źródła ani chronionych aut i sam nie zadaje eliminacji; nadal może wypchnąć rywala poza drogę/kadr. Zeruje też bonus doganiania trafionego auta. Testy obejmują dokładne końce zasięgu, skrócony sweep przy dużej prędkości, przeszkody przed i za limitem, pauzę, wybuchy własnych i cudzych rakiet, kolizję ze ścianą oraz rozrzucenie siedmiu rywali przez jeden impuls. `/handling-check` udostępnia przyciski rakiety, mrozu i impulsu oraz rzeczywisty odczyt długości lotu.
