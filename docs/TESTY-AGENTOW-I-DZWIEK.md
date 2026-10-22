# Testy agentów i efekty dźwiękowe

Odbiór lokalny: 21 października 2026. Projekt `/Users/benjaminrast/projects/turbo-rumble`.

## Co zmieniono

- Osobne proceduralne efekty: odliczanie, start, pickup, nitro, rakieta, mina, pocisk mrozu, trafienie mrozem, impuls, eksplozja, eliminacja, uderzenie, rozliczenie rundy, okrążenie, wygrana i krótki sygnał gotowości.
- Dźwięk silnika reaguje na prędkość i nitro. Odległość i strona zdarzenia wpływają na miks. Limiter ogranicza poziom wielu jednoczesnych efektów.
- Dźwięk uruchamia gest na ekranie hosta. Jest wyciszenie całego miksu i zapamiętywana głośność. Ukrycie karty wycisza miks; telefony nie powielają dźwięku hosta.
- Zdarzenie strzału zawiera rodzaj broni. Rzeczywiste gwałtowne zmiany prędkości po kroku fizyki generują zdarzenie uderzenia z siłą i ograniczeniem częstości.
- **Poprawiono nitro z postoju.** Wcześniej wyższa prędkość maksymalna nie dawała korzyści przed końcem bonusu, bo przyspieszenie było identyczne. Podczas nitro limit przyspieszenia wynosi teraz 20 zamiast 10 m/s². Czas bonusu i docelowa prędkość nie zmieniły się. Dodany test wymaga rzeczywistej przewagi prędkości i przebytej drogi po 60 tickach.

## Wspólny mecz trzech agentów

Pokój **88TFS7**, trzej niezależni gracze i pięć botów, pięć rund. Ada używała rzeczywistego interfejsu pada w przeglądarce, Borys i Celina sterowali niezależnymi klientami Socket.IO reagującymi na stan gry.

| Gracz | Wynik | Miejsce w ósemce |
| --- | ---: | ---: |
| Agent Celina | 10 | 1 |
| Agent Borys | 6 | 4 |
| Agent Ada | 2 | 7 |

Działały kierowanie, hamowanie, wszystkie pięć przedmiotów, eliminacje, odrodzenia, trzy okrążenia i koniec meczu. Osobna próba UI objęła tworzenie pokoju, LAN URL z QR, gotowość, wyniki i rewanż; konsola hosta/padów bez ostrzeżeń i błędów w obserwowanych scenariuszach.

Dowody: [wynik meczu](qa/team-results.json), [raport Borysa](qa/borys-play.json), [pad Ady po meczu](qa/agent-ada-finish.png).

## Mechanika i sieć

**32 testy kodu PASS.** Oprócz wcześniejszych scenariuszy: punktacja 3/4/8 osób, częściowe i całkowite remisy, rzeczywisty pocisk mrozu, pickup i 250 ticków odnowienia, 26 ticków poza kadrem, upadek mimo ochrony startowej, fizyczna rampa i lądowanie, koniec trzeciej pętli, reset przy rewanżu, zasięg i ochrona przed impulsem, nitro z postoju oraz jednokrotne dźwięki pomimo powtórzonych snapshotów. Dodatkowo agent ukończył 24 pełne symulacje różnych rozmiarów meczu bez NaN i punktów poza zakresem.

Po poprawce nitro i dodaniu zdarzeń audio rozegrano jeszcze pełny mecz **JYD67B** ośmioma niezależnymi kontrolerami (wszyscy `bot:false`): 96 s, pięć rund, 23 asercje sieciowe PASS. Sprawdzono limit 8/9, gotowość, autoryzację, błędne wejścia, reconnect, takeover, pauzę/wznowienie hosta, koniec, zapis dokładnie raz, rewanż i lobby.

Zarejestrowano 62 strzały, 14 impulsów, 18 eksplozji, 15 zamrożeń, 21 kolizji, 68 pickupów i 32 eliminacje. Wszystkie strzały miały poprawny rodzaj broni; kolizje poprawną siłę. Osobny test utraty pada na ponad 2 s potwierdził eliminację, punktację 6/4 i odrodzenie po ponownym połączeniu.

Raporty: [końcowy mecz sieciowy](qa/network-final.json), [odłączenie pada](qa/network-disconnect.json), [wcześniejsza próba](qa/network-before.json).

## Rzeczywisty sygnał audio

Narzędzie `/audio-check` używa tego samego kodu Web Audio co gra. **22/22 pomiary PASS**: 16 osobnych efektów, silnik zwykły i nitro, cisza przy master mute, wyższy ton silnika z nitro, stereo oraz miks 16 eksplozji z limiterem. Sprawdzono skończone próbki, peak/RMS, brak przesterowania i ciszę po wybrzmieniu. Szczyt miksu testowego: około 0,79. W przeglądarce sprawdzono też uruchomienie AudioContext gestem, zmianę głośności, mute i pamiętanie ustawień; kierowanie nie odcisza ręcznie wyciszonej gry.

[Raport pomiarów](qa/audio-report.json) · [próbka pierwszych 16 efektów WAV](qa/effects.wav) · [obraz testu audio](qa/audio-check.png).

## Powtórzenie

```sh
npm test
npm run build
# z działającym serwerem:
npm run smoke
npm run playtest
```

Test audio: `http://localhost:4317/audio-check`, przycisk „Sprawdź i odtwórz efekty”. Główna gra: `http://localhost:4317`.

Nie testowano fizycznych telefonów Android/iOS, zakłóconej sieci Wi-Fi ani głośników użytkownika. Pomiary potwierdzają generowanie prawidłowego sygnału w przeglądarce; nie zastępują odsłuchu i testu urządzeń.
