# Sundown Circuit XL i interakcje fizyczne

Zmiana z 21 października 2026.

## Większa pierwsza mapa

| Element | Wcześniej | Teraz |
| --- | ---: | ---: |
| Długość osi toru | 444,23 m | 897,51 m |
| Przeszkody | 4 skrzynie | 28: 9 skrzyń, 9 beczek, 6 barier, 4 skały |
| Przeszkody ruchome | 0 | 18 |
| Rampy | 1 | 3 |
| Punkty odbioru przedmiotów | 36 | 72 |

Nowy przebieg ma dłuższe odcinki i dodatkowe zakręty. Centripetalna krzywa i test promienia łuku zapobiegają zawijaniu wewnętrznej krawędzi jezdni. Test sprawdza również odległość między odległymi fragmentami toru. Rampy mają wspólną geometrię renderowania i kolizji, a początek klina jest schowany pod asfaltem, aby nie tworzył pionowego progu blokującego auto.

Kamera podglądu obejmuje większy obszar. Powtarzalne krawężniki, oznaczenia, bariery i podbudowa drogi są renderowane instancjami. Przy nowej rundzie siatka startowa szuka miejsca wolnego od przeszkód i ramp.

## Jakiej fizyki używamy

Serwer używa **Rapier 3D**, nadal w stałym kroku 20 ms (50 Hz). Ruch jest zręcznościowy: automatyczny gaz i kontrolowana przyczepność boczna względem ustawienia auta. Gracze kierują samodzielnie, bez śledzenia toru; tylko boty mają autopilota. Kontakt, grawitacja, pęd i impulsy rozwiązywane są przez silnik fizyki. Masa auta wynosi 200 kg, a obrót aktywnego auta ograniczony jest do osi pionowej dla stabilnego sterowania.

### Samochody i przeszkody

Auta są dynamicznymi bryłami z koliderami i CCD. Zderzenia samochodów przekazują pęd. Drewniane skrzynie (45 kg) i beczki (28 kg) są teraz dynamicznymi bryłami: można je przesunąć, przewrócić lub rozrzucić wybuchem. Betonowe bariery i skały pozostają stałymi koliderami. Pozycje i pełne obroty ruchomych obiektów trafiają do klientów ze stanu serwera; renderer je interpoluje.

Geometria kontaktowa jest uproszczona: auto i skrzynia mają kolidery pudełkowe, beczka i mina cylindryczne. To model odpowiedni dla tej zręcznościowej gry; nie dodano osobnej symulacji opon i zawieszenia.

### Miny

Wcześniej mina była nieruchomą pozycją w logice gry. Teraz jest dynamicznym cylindrem o masie 6 kg: spada z auta, osiada dzięki grawitacji i tarciu oraz reaguje na kontakt. Zachowano uzbrojenie po 0,5 s oraz początkową ochronę właściciela. Wygaśnięcie, detonacja, powrót do lobby lub nowa runda usuwają również jej ciało fizyczne ze świata.

### Rakiety i wybuchy

Rakieta sprawdza całą objętość przebytego odcinka metodą `castShape` z kulą o promieniu 0,24 m. Pierwsze trafienie w kolider auta, przeszkody albo ściany kończy lot. To metoda typu sweep, zamiast fizycznego korpusu rakiety napędzanego silnikiem; zapobiega przeskakiwaniu przez cienkie ściany między klatkami.

Eksplozja nadaje bryłom **impuls liniowy i moment obrotowy** z malejącą siłą wraz z odległością. Rdzeń 3,1 m eliminuje jak wcześniej, a zewnętrzny zasięg 7,5 m odrzuca pozostałe auta. Luźne przeszkody reagują do 9 m. Stałe kolidery osłaniają obiekty po drugiej stronie. U trafionego i wyeliminowanego auta odblokowują się wszystkie osie obrotu; przez 1,4 s widać fizyczny, podrzucony wrak, zanim zniknie. Fizyka wraków działa także podczas rozliczania rundy.

Wcześniej wybuch rakiety/miny jedynie eliminował auto. Teraz skutki widoczne w grze wynikają z impulsów w Rapierze, obok kosmetycznej kuli ognia i fali uderzeniowej.

Źródła projektu silnika: [bryły, siły i impulsy](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/), [kolidery](https://rapier.rs/docs/user_guides/javascript/colliders/), [zapytania i shape casting](https://rapier.rs/docs/user_guides/javascript/scene_queries/). Sygnatury API sprawdzono również w typach zainstalowanej wersji biblioteki.

## Weryfikacja

**43 testy PASS**, w tym:

- miny spadają i osiadają; ciało fizyczne jest usuwane po detonacji/resetowaniu;
- eksplozja podrzuca ofiarę, wrak nadal się porusza i znika po czasie;
- zewnętrzna fala rakiety odrzuca ocalałe auto;
- szybka rakieta trafia najpierw w ścianę, a auto za ścianą pozostaje osłonięte;
- samochody odbijają się z przekazaniem pędu;
- samochód przesuwa skrzynię, a snapshot zawiera jej nową pozycję;
- wybuch porusza luźne przeszkody;
- wszystkie trzy rampy umożliwiają wybicie i lądowanie;
- geometria toru, punktacja, broń, odłączenia i pełny mecz ośmiu botów.

Pełny test sieciowy końcowej mapy: pokój **YCAXM8**, osiem niezależnych kontrolerów, pięć rund, poprawny koniec, zapis wyniku dokładnie raz, rewanż i powrót do lobby. Zarejestrowano 63 strzały, 18 impulsów, 17 eksplozji, 36 kolizji, 34 eliminacje i 73 pickupy. [Raport](qa/map-physics-final-network.json).

`npm run build` kończy się powodzeniem. Oględziny mapy i próba jazdy wykonane w przeglądarce. Nie wykonywano nowej próby fizycznych telefonów.

Uruchomienie i sterowanie: [README](../README.md).
