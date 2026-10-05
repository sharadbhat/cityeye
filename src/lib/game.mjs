import { locationHint } from './geography.mjs';

export const MAX_GUESSES = 5;
export const MAX_STAGE = 5;

function numericId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Choose uniformly from playable cities, avoiding the last map when possible. */
export function chooseCity(cities, previousId = null, random = Math.random) {
  if (!Array.isArray(cities) || cities.length === 0) return null;
  const alternatives = cities.filter(city => (
    city.key !== previousId && city.id !== previousId && city.geonameId !== previousId
  ));
  const pool = alternatives.length ? alternatives : cities;
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('The random function must return a value from 0 up to, but not including, 1.');
  }
  return pool[Math.floor(value * pool.length)];
}

export function createRound(city) {
  if (!city || numericId(city.geonameId) === null) {
    throw new TypeError('A playable city must have a valid GeoNames ID.');
  }
  return { city, stage: 1, guesses: [], status: 'playing' };
}

/**
 * Return { round, outcome, message }, without mutating the supplied round.
 * Invalid, duplicate and ended submissions preserve the original round object.
 * Five guesses allow one attempt at every reveal stage, including stage five.
 */
export function submitGuess(round, guess) {
  if (round.status !== 'playing') {
    return { round, outcome: 'ended', message: 'This round is over. Start a new city to play again.' };
  }
  const id = numericId(guess?.id);
  if (id === null) {
    return { round, outcome: 'invalid', message: 'Select a city from the suggestions before guessing.' };
  }
  if (round.guesses.some(previous => previous.id === id)) {
    return { round, outcome: 'duplicate', message: 'You have already guessed that city. Try a different one.' };
  }

  const correct = id === numericId(round.city.geonameId);
  const hint = correct ? null : locationHint(guess, round.city);
  const guesses = [...round.guesses, { ...guess, id, correct, hint }];
  const name = round.city.label ?? round.city.name ?? 'the city';
  if (correct) {
    return {
      round: { ...round, guesses, status: 'won' },
      outcome: 'correct',
      message: `Correct! It is ${name}.`,
    };
  }
  if (guesses.length >= MAX_GUESSES) {
    return {
      round: { ...round, guesses, stage: MAX_STAGE, status: 'lost' },
      outcome: 'lost',
      message: `No guesses left. The city was ${name}.`,
    };
  }
  return {
    round: { ...round, guesses, stage: Math.min(round.stage + 1, MAX_STAGE) },
    outcome: 'incorrect',
    message: `Not quite. Stage ${Math.min(round.stage + 1, MAX_STAGE)} is now revealed.`,
  };
}

/** A skip spends the current attempt, but leaves the final clue guessable. */
export function skipClue(round) {
  if (round.status !== 'playing') {
    return { round, outcome: 'ended', message: 'This round is over. Start a new city to play again.' };
  }
  if (round.stage >= MAX_STAGE) {
    return { round, outcome: 'no-more-clues', message: 'This is the final clue. Guess the city or reveal the answer.' };
  }
  const stage = round.stage + 1;
  return {
    round: { ...round, stage, guesses: [...round.guesses, { skipped: true, correct: false, hint: null }] },
    outcome: 'skipped',
    message: `Skipped. Stage ${stage} is now revealed.`,
  };
}

export function giveUp(round) {
  if (round.status !== 'playing') {
    return { round, outcome: 'ended', message: 'This round is over. Start a new city to play again.' };
  }
  return {
    round: { ...round, stage: MAX_STAGE, status: 'lost' },
    outcome: 'gave-up',
    message: `The city was ${round.city.label ?? round.city.name ?? 'the selected city'}.`,
  };
}
