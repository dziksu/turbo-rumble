# Kontrola nakładania powierzchni mapy — 21.10.2026

Sprawdzono Sundown Circuit XL w scenie Three.js z widoku wyścigu, detalu poboczy i całego toru. Problem dotyczył przede wszystkim nakładającej się geometrii i precyzji bufora głębi, a nie plików bitmapowych tekstur.

| Miejsce             | Przyczyna                                                                                               | Poprawka                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Krawężniki          | Klocki długości 3,25 m rozstawione co 3,2 m; wewnątrz zakrętów pokrywały jeszcze większy obszar.        | Ciągłe pasy z naprzemiennym kolorem i wspólną krawędzią, bez zduplikowanych płaszczyzn.                                      |
| Boki toru           | Podbudowa z przecinających się prostopadłościanów zostawiała na zakrętach odsłonięte poziome fragmenty. | Jedna ciągła powierzchnia ścian bocznych, połączona z poboczem.                                                              |
| Barierki            | Proste segmenty zachodziły na siebie na zakrętach i przy zamknięciu pętli.                              | Widoczne segmenty biegną po krzywej; początek i koniec pętli mają rozdzielone zakresy. Odcinki otwarte zachowano.            |
| Rampy               | Widoczny początek rampy znajdował się pod asfaltem i przecinał go przy wjeździe.                        | Tylko widoczna geometria wejścia uniesiona do 0,035 m; asfalt pozostaje na 0,02 m. Wysokość końca i model kolizji zachowane. |
| Meta i pasy         | Środkowy pasek przechodził przez szachownicę na bardzo bliskiej wysokości.                              | Przerwa w malowaniu osi drogi wokół mety.                                                                                    |
| Daleki widok        | Kamera 0,1–900 m miała niepotrzebnie mały near plane dla ujęć z kilkudziesięciu metrów.                 | Near plane 1 m; większa precyzja głębi bez zmiany pola widzenia.                                                             |
| Ślady wybuchów/opon | Offset miał tylko składnik zależny od nachylenia; sadza rzutowała się także na boki i spód ramp.        | Dodany stały składnik offsetu; sadza przycięta do trójkątów skierowanych ku górze.                                           |

Sprawdzono wizualnie trzy rampy, dwa nawroty, linię startu, barierę z pasami, nakładające się ślady wybuchów i widok całego toru. W przeglądarce nie wystąpiły błędy konsoli. Nie wykonywano przekrojowego testu wszystkich kart graficznych i przeglądarek.

Sześć regresji w `tests/track-surfaces.test.ts` sprawdza pojedyncze pokrycie krawężników na wszystkich granicach kolorów, brak nakładania barierek i zachowanie otwartych odcinków, brak poziomych płyt podbudowy, rozdzielenie widocznych ramp od asfaltu bez modyfikacji fizyki, przerwę wokół mety oraz poprawne przycinanie sadzy. Sprawdzenie raycast korzysta z rzeczywistych trójkątów generowanej geometrii.

Porównania i raport:

- [Rampa przed](qa/surface-ramp-before.png) / [rampa po](qa/surface-ramp-after.png).
- [Nawrót północny](qa/surface-north-corner.png) / [nawrót południowy](qa/surface-south-corner.png).
- [Sadza na rampie](qa/surface-ramp3-scorches.png), [meta](qa/surface-start-line.png), [cały tor](qa/surface-overview.png).
- [Wyniki kontroli](qa/surface-verification.json).

Do powtórzenia oględzin uruchom `npm run dev` i otwórz `/map-check`. To narzędzie deweloperskie korzysta z tych samych modeli, materiałów i geometrii co gra; jedynie wyłącza mgłę i zatrzymuje kamerę, aby łatwo porównać powierzchnie. Parametry `s` i `view` przechowują wybrane ujęcie w adresie.
