import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseCity, createRound, submitGuess, skipClue, giveUp, MAX_GUESSES } from '../src/lib/game.mjs';

const slc = { key: 'slc', id: 5780993, geonameId: 5780993, label: 'Salt Lake City' };
const nyc = { key: 'nyc', id: 5128581, geonameId: 5128581, label: 'New York City' };
const sf = { key: 'sf', id: 5391959, geonameId: 5391959, label: 'San Francisco' };
const wrongGuess = id => ({ id, name: `Wrong city ${id}`, region: 'Region', country: 'Country' });

test('chooseCity picks every equal-sized random interval', () => {
  const cities = [slc, nyc, sf];
  assert.equal(chooseCity(cities, null, () => 0), slc);
  assert.equal(chooseCity(cities, null, () => 0.34), nyc);
  assert.equal(chooseCity(cities, null, () => 0.99), sf);
});

test('chooseCity avoids the previous city by map key or numeric ID', () => {
  assert.equal(chooseCity([slc, nyc, sf], 'slc', () => 0), nyc);
  assert.equal(chooseCity([slc, nyc, sf], 5128581, () => 0.6), sf);
  assert.equal(chooseCity([slc], 'slc', () => 0), slc);
  assert.equal(chooseCity([], null, () => 0), null);
});

test('chooseCity rejects a broken random source', () => {
  for (const value of [-1, 1, NaN, Infinity]) {
    assert.throws(() => chooseCity([slc], null, () => value), RangeError);
  }
});

test('a new round has one visible stage and no guesses', () => {
  assert.deepEqual(createRound(slc), { city: slc, stage: 1, guesses: [], status: 'playing' });
  assert.throws(() => createRound({ label: 'Missing ID' }), TypeError);
});

test('skipping spends one attempt and reveals the next clue without city or distance data', () => {
  const initial = createRound(slc);
  const result = skipClue(initial);
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.round.stage, 2);
  assert.equal(result.round.status, 'playing');
  assert.deepEqual(result.round.guesses, [{ skipped: true, correct: false, hint: null }]);
  assert.equal(initial.guesses.length, 0);
  assert.equal(initial.stage, 1);
});

test('four skips leave one final guess and cannot skip past the country clue', () => {
  let round = createRound(slc);
  for (let count = 0; count < 4; count++) round = skipClue(round).round;
  assert.equal(round.stage, 5);
  assert.equal(round.guesses.length, 4);
  assert.equal(round.status, 'playing');
  assert.equal(skipClue(round).round, round);
  assert.equal(skipClue(round).outcome, 'no-more-clues');
  assert.equal(submitGuess(round, { id: slc.id }).outcome, 'correct');
  assert.equal(submitGuess(round, wrongGuess(nyc.id)).outcome, 'lost');
});

test('mixed skips and guesses share the five-attempt limit, with duplicate checks unchanged', () => {
  let round = submitGuess(createRound(slc), wrongGuess(nyc.id)).round;
  round = skipClue(round).round;
  assert.equal(submitGuess(round, wrongGuess(nyc.id)).outcome, 'duplicate');
  assert.equal(round.guesses.length, 2);
  round = submitGuess(round, wrongGuess(sf.id)).round;
  round = skipClue(round).round;
  const result = submitGuess(round, wrongGuess(123));
  assert.equal(result.outcome, 'lost');
  assert.equal(result.round.guesses.length, 5);
});

test('skipping a finished round leaves it unchanged', () => {
  for (const round of [giveUp(createRound(slc)).round, submitGuess(createRound(slc), { id: slc.id }).round]) {
    assert.equal(skipClue(round).round, round);
    assert.equal(skipClue(round).outcome, 'ended');
  }
});

test('an incorrect guess reveals one stage and retains location context', () => {
  const initial = createRound(slc);
  const guess = wrongGuess(nyc.id);
  const result = submitGuess(initial, guess);
  assert.equal(result.outcome, 'incorrect');
  assert.equal(result.round.stage, 2);
  assert.equal(result.round.status, 'playing');
  assert.deepEqual(result.round.guesses[0], { ...guess, correct: false, hint: null });
  assert.equal(initial.guesses.length, 0);
  assert.equal(initial.stage, 1);
});

test('the fifth stage remains guessable after four incorrect guesses', () => {
  let round = createRound(slc);
  for (let i = 0; i < MAX_GUESSES - 1; i += 1) round = submitGuess(round, wrongGuess(i + 1)).round;
  assert.equal(round.stage, 5);
  assert.equal(round.status, 'playing');
  assert.equal(round.guesses.length, 4);
  const result = submitGuess(round, { id: slc.id, name: 'SLC' });
  assert.equal(result.outcome, 'correct');
  assert.equal(result.round.status, 'won');
  assert.equal(result.round.guesses.length, 5);
  assert.equal(result.round.stage, 5);
});

test('five wrong guesses end the round without advancing past stage five', () => {
  let result = { round: createRound(slc) };
  for (let i = 0; i < MAX_GUESSES; i += 1) result = submitGuess(result.round, wrongGuess(i + 1));
  assert.equal(result.outcome, 'lost');
  assert.equal(result.round.status, 'lost');
  assert.equal(result.round.stage, 5);
  assert.equal(result.round.guesses.length, 5);
  assert.match(result.message, /Salt Lake City/);
});

test('correct IDs win independently of the name, while matching names with different IDs do not', () => {
  const result = submitGuess(createRound(slc), { id: String(slc.id), name: 'Alternate spelling' });
  assert.equal(result.outcome, 'correct');
  assert.equal(result.round.status, 'won');
  assert.equal(result.round.stage, 1);
  assert.equal(result.round.guesses[0].id, slc.id);
  assert.equal(submitGuess(createRound(slc), { id: nyc.id, name: 'Salt Lake City' }).outcome, 'incorrect');
});

test('duplicate selected IDs do not consume attempts or reveal stages', () => {
  const round = submitGuess(createRound(slc), wrongGuess(nyc.id)).round;
  const result = submitGuess(round, { id: String(nyc.id), name: 'NYC' });
  assert.equal(result.outcome, 'duplicate');
  assert.equal(result.round, round);
  assert.equal(round.stage, 2);
  assert.equal(round.guesses.length, 1);
});

test('invalid selections do not consume attempts or reveal stages', () => {
  const round = createRound(slc);
  for (const guess of [null, undefined, {}, { name: 'Text only' }, { id: '' }, { id: -1 }, { id: 0 }, { id: NaN }, { id: 1.5 }, { id: [slc.id] }]) {
    const result = submitGuess(round, guess);
    assert.equal(result.outcome, 'invalid');
    assert.equal(result.round, round);
  }
});

test('finished rounds are unchanged by later submissions and give-up', () => {
  const won = submitGuess(createRound(slc), { id: slc.id }).round;
  assert.equal(submitGuess(won, wrongGuess(nyc.id)).round, won);
  assert.equal(submitGuess(won, wrongGuess(nyc.id)).outcome, 'ended');
  assert.equal(giveUp(won).round, won);
  const lost = giveUp(createRound(slc)).round;
  assert.equal(submitGuess(lost, { id: slc.id }).round, lost);
});

test('giving up reveals the answer and map without recording a guess', () => {
  const round = submitGuess(createRound(slc), wrongGuess(nyc.id)).round;
  const result = giveUp(round);
  assert.equal(result.outcome, 'gave-up');
  assert.equal(result.round.status, 'lost');
  assert.equal(result.round.stage, 5);
  assert.equal(result.round.guesses, round.guesses);
  assert.equal(result.round.guesses.length, 1);
  assert.match(result.message, /Salt Lake City/);
});

test('wrong guesses retain distance and direction toward the answer, not away from it', () => {
  const city = { ...slc, latitude: 1, longitude: 0 };
  const guess = { ...wrongGuess(nyc.id), latitude: 0, longitude: 0 };
  const result = submitGuess(createRound(city), guess);
  const { hint } = result.round.guesses[0];
  assert.equal(hint.direction, 'N');
  assert.ok(Math.abs(hint.distanceKm - 111.195) < 0.001);
  assert.equal(result.round.stage, 2);
  assert.equal(result.round.guesses.length, 1);
  const duplicate = submitGuess(result.round, guess);
  assert.equal(duplicate.round, result.round);
  assert.equal(duplicate.round.guesses[0].hint, hint);
});

test('correct guesses have no direction/distance clue and final wrong guesses keep their clue', () => {
  const city = { ...slc, latitude: 40.7608, longitude: -111.891 };
  const correct = submitGuess(createRound(city), { ...city, id: city.geonameId });
  assert.equal(correct.round.guesses[0].hint, null);
  let round = createRound(city);
  for (let id = 1; id <= 5; id += 1) {
    round = submitGuess(round, { ...wrongGuess(id), latitude: 0, longitude: 0 }).round;
  }
  assert.equal(round.status, 'lost');
  assert.ok(round.guesses.every((guess) => guess.hint.distanceKm > 0));
});
