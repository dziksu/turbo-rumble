# Dynamika jazdy, drift i wybuchy — 21.10.2026

## Samochody

- Maksymalna reakcja skrętu: 2,95 rad/s zamiast 1,65 rad/s, około 79% mocniej. Moc przyspieszania bez nitro wzrosła z 10 do 13 m/s²; prędkość docelowa pozostaje 18 m/s.
- Model opon działa względem faktycznego ustawienia samochodu. Przytrzymanie skrętu powyżej 10 m/s stopniowo obniża przyczepność boczną i pozwala wejść w drift. Puszczenie kierunku przywraca przyczepność, a kontra redukuje narastający poślizg. Oba przyciski hamują i wygaszają drift.
- Kontakt z nawierzchnią sprawdza raycast Rapiera; w locie napęd nie przyspiesza auta, a możliwość obrotu jest ograniczona. Gracze nadal nie mają autopilota. Boty zachowują swoje prowadzenie po torze.
- Obracają się koła, przednie koła skręcają, a nadwozie lekko przechyla się w zakręcie. Przy faktycznym poślizgu pojawiają się dym oraz dwie smugi opon.
- Parametry modelu zebrano w `shared/driving.ts`.

## Wybuchy i nawierzchnia

Wybuch rakiety lub miny uruchamia krótki impuls kamery: maksymalnie 0,25 m w bok, 0,18 m w pionie i około 0,34° przechyłu. Efekt wygasa w 0,48 s i słabnie z odległością. Nie kumuluje przesunięcia kamery i respektuje `prefers-reduced-motion`.

Miękka, czarna plama sadzy jest projektowana na prawdziwe trójkąty asfaltu i ramp. Jest przycinana na krawędzi drogi. Pozostaje przez 45 s, wygasa przez ostatnie 10 s i znika przy nowym meczu. Limity: 48 przypaleń, 900 segmentów śladów opon i 80 drobin dymu. Geometria oraz materiały usuwanych efektów są zwalniane.

## Gotowe rozwiązania

Sprawdzono [kontroler pojazdów Rapiera](https://rapier.rs/docs/user_guides/javascript/vehicle_controller/) z kołami opartymi na raycastach i [Cannon-es](https://github.com/pmndrs/cannon-es). Pozostała istniejąca fizyka Rapiera oraz własna, niewielka warstwa opon dla szybkiego sterowania zręcznościowego. Pełny kontroler zawieszenia wymagałby zmiany obecnego modelu kontaktu samochodu z podłożem i ponownego strojenia ramp oraz zderzeń.

Do przypaleń wykorzystano gotowy [DecalGeometry z Three.js](https://threejs.org/docs/pages/DecalGeometry.html). Tekstury sadzy i dymu powstają lokalnie w Canvas, bez dodatkowych pobrań ani zależności.

## Weryfikacja

- 62/62 testy: kierunki skrętu, brak autopilota, rzeczywisty poślizg, odzyskiwanie przyczepności, kontra, hamulec, lot, reset rundy, broń, fizyczne kolizje i rampy, ograniczenia drgania kamery oraz przycinanie plam na krawędzi asfaltu.
- Pomiar symulacji: start przy 16 m/s, skręt przez 400 ms — obrót 67,6°, poślizg do 24,8°, prędkość końcowa 56,1 km/h.
- Próba w przeglądarce: drift do 26,9°, widoczne ślady opon i przypalenie, zmierzone drganie kamery 0,161 m, brak błędów JavaScript.
- Pełny mecz 8 niezależnych klientów: ukończony, wszystkie bronie, zapis wyniku, ponowny mecz, utrata i powrót hosta oraz ponowne połączenie pada. Raport: `qa/drift-network.json`.
- TypeScript i build produkcyjny przechodzą. Narzędzie `/handling-check` jest dostępne wyłącznie w trybie developerskim i korzysta z tej samej symulacji oraz renderera co gra.

Zrzuty: `qa/drift-handling.png`, `qa/explosion-scorch.png`. Przytrzymaj skręt, aby rozpocząć drift; puść kierunek lub skontruj, aby odzyskać przyczepność.
