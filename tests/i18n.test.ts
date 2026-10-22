import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EN, languageLocale, parseLanguage, translate } from '../client/i18n/messages.ts';

test('first visit and unsupported saved languages use English; Polish is explicit', () => {
  for (const saved of [null, undefined, '', 'de', 'PL', {}, 1])
    assert.equal(parseLanguage(saved), 'en');
  assert.equal(parseLanguage('pl'), 'pl');
  assert.equal(translate('Stwórz pokój', 'en'), 'Create a room');
  assert.equal(translate('Stwórz pokój', 'pl'), 'Stwórz pokój');
});
test('both languages retain the same dynamic placeholders', () => {
  const tokens = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [source, english] of Object.entries(EN)) {
    assert.ok(english.trim(), source);
    assert.deepEqual(tokens(english), tokens(source), source);
  }
});
test('names and codes are inserted literally, including braces and replacement metacharacters', () => {
  const name = 'A {code} $& <b>Łódź</b>';
  assert.equal(translate('{name} wygrywa!', 'en', { name, code: 'ABC234' }), name + ' wins!');
  assert.equal(
    translate('Ustawieniami zarządza {name}.', 'pl', { name }),
    'Ustawieniami zarządza ' + name + '.',
  );
  assert.equal(translate('RUNDA {round}', 'en', { round: 0 }), 'ROUND 0');
});
test('known server errors translate; unknown text is preserved without interpreting it', () => {
  assert.equal(translate('Wszystkie 8 miejsc jest zajętych.', 'en'), 'All 8 seats are taken.');
  assert.equal(translate('toString', 'en'), 'toString');
  assert.equal(translate('Driver Rakieta {name}', 'en'), 'Driver Rakieta {name}');
});

test('activity uses the shared English default, Polish choice and matching date locale', () => {
  const language = parseLanguage(null);
  assert.equal(languageLocale(language), 'en-GB');
  assert.equal(languageLocale(parseLanguage('pl')), 'pl-PL');
  assert.equal(translate('Aktywność graczy', language), 'Player activity');
  assert.equal(translate('Zakres statystyk', language), 'Statistics period');
  assert.equal(translate('Ostatnie 7 dni', language), 'Last 7 days');
  for (const source of [
    'Ładowanie danych…',
    'Brak aktywności w wybranym okresie.',
    'Historia maksymalnej liczby graczy online i w rozgrywce',
    'Nie udało się odświeżyć danych. Widoczne dane mogą być nieaktualne. Ponowna próba za 15 s.',
  ]) {
    assert.notEqual(translate(source, language), source);
    assert.equal(translate(source, 'pl'), source);
  }
  assert.equal(
    translate('{date} · online: {online} · w rozgrywce: {playing}', language, {
      date: '22 Oct',
      online: 8,
      playing: 6,
    }),
    '22 Oct · online: 8 · playing: 6',
  );
});
