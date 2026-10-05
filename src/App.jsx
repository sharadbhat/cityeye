import { useCallback, useEffect, useRef, useState } from "react";
import CityMap from "./components/CityMap.jsx";
import CitySearch, { cityContext } from "./components/CitySearch.jsx";
import {
  createRound,
  giveUp,
  MAX_GUESSES,
  MAX_STAGE,
  skipClue,
  submitGuess,
} from "./lib/game.mjs";
import { formatDistanceKm } from "./lib/geography.mjs";
import { attachDetailsDismissal } from "./lib/details-dismissal.mjs";
import { confettiOrigin, createWinConfetti } from "./lib/win-confetti.mjs";
import { STAGE_HINTS } from "./lib/reveal-stages.mjs";
import { geographyClue } from "./lib/city-clues.mjs";
import { cityDirectory } from "./lib/city-directory.mjs";
import { createCitySession } from "./lib/city-session.mjs";

function Icon({ name, ...props }) {
  const paths = {
    arrow: (
      <>
        <path d="M4 12h15m-6-6 6 6-6 6" />
      </>
    ),
    compass: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export default function App() {
  const [cities, setCities] = useState([]);
  const [round, setRound] = useState(null);
  const [roundNumber, setRoundNumber] = useState(1);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [bootError, setBootError] = useState("");
  const [retry, setRetry] = useState(0);
  const [wins, setWins] = useState(0);
  const instructionsRef = useRef(null);
  const confettiRef = useRef(null);
  const citySessionRef = useRef(null);
  if (!citySessionRef.current) citySessionRef.current = createCitySession();

  useEffect(() => attachDetailsDismissal(instructionsRef.current), []);
  useEffect(() => {
    const celebration = createWinConfetti();
    confettiRef.current = celebration;
    return () => {
      celebration.dispose();
      if (confettiRef.current === celebration) confettiRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setBootError("");
    cityDirectory.loadPlayableCities()
      .then((playable) => {
        if (!Array.isArray(playable) || !playable.length)
          throw new Error("No playable maps are available.");
        if (controller.signal.aborted) return;
        setCities(playable);
        setRound(createRound(citySessionRef.current.next(playable)));
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setBootError(
            `${error.message} Please reload to try again.`,
          );
      });
    return () => controller.abort();
  }, [retry]);

  const onMapReady = useCallback((ready) => setMapReady(ready), []);
  const onMapError = useCallback((error) => setMapError(error), []);
  const playing = round?.status === "playing";
  const won = round?.status === "won";
  const remaining = MAX_GUESSES - (round?.guesses.length ?? 0);
  const stage = round?.stage ?? 1;

  const handleGuess = (event) => {
    event.preventDefault();
    if (!round || !mapReady || mapError) return;
    const result = submitGuess(round, selected);
    setMessage(result.message);
    if (result.round !== round) {
      setRound(result.round);
      setSelected(null);
      if (result.outcome === "correct") {
        setWins((total) => total + 1);
        const button = event.currentTarget.querySelector(
          'button[type="submit"]',
        );
        void confettiRef.current?.celebrate({
          outcome: result.outcome,
          roundId: `${retry}-${roundNumber}`,
          origin: confettiOrigin(button?.getBoundingClientRect(), {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        });
      }
    }
  };
  const handleGiveUp = () => {
    if (!round) return;
    const result = giveUp(round);
    setRound(result.round);
    setMessage(result.message);
    setSelected(null);
  };
  const nextRound = () => {
    confettiRef.current?.cancel();
    setMapReady(false);
    setMapError("");
    setSelected(null);
    setMessage("");
    setRound(createRound(citySessionRef.current.next(cities)));
    setRoundNumber((number) => number + 1);
  };
  const handleSkip = () => {
    if (!round || !mapReady || mapError) return;
    const result = skipClue(round);
    setRound(result.round);
    setMessage(result.message);
    if (result.round !== round) setSelected(null);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="CityEye home">
          <span className="brand-mark">
            <Icon name="compass" />
          </span>
          CityEye<span className="brand-period">.</span>
        </a>
        <div className="header-right">
          <span className="session-stat">
            <span>{wins}</span> discovered
          </span>
          <details ref={instructionsRef} className="instructions">
            <summary>
              How to play <span>?</span>
            </summary>
            <div className="instructions-popover">
              <h2>Find your bearings.</h2>
              <p>
                Guess the city from its map. Search worldwide and select a city,
                then submit your guess.
              </p>
              <p>
                Every wrong guess reveals more context and zooms out. You have
                five attempts, including one at the final country clue. Skip
                uses an attempt and reveals the next clue without a city guess.
              </p>
              <p>
                Wrong guesses also show the straight-line distance between city
                centers and the initial compass direction from your guess toward
                the answer.
              </p>
              <p>
                Repeated guesses don’t use an attempt. Solve it or reveal the
                answer, then explore a new city.
              </p>
            </div>
          </details>
        </div>
      </header>

      <main>
        {bootError ? (
          <section className="boot-error" role="alert">
            <h2>Let’s get the maps ready.</h2>
            <p>{bootError}</p>
            <button onClick={() => setRetry((value) => value + 1)}>
              Try again
            </button>
          </section>
        ) : (
          <div className="game-layout">
            <section className="map-panel" aria-label="Mystery city map">
              <div className="map-frame">
                {round ? (
                  <CityMap
                    key={`${roundNumber}-${retry}`}
                    svgUrl={round.city.svgUrl}
                    stage={stage}
                    geographyClue={geographyClue(round.city, stage)}
                    onReady={onMapReady}
                    onError={onMapError}
                  />
                ) : (
                  <div className="map-loading">
                    <span className="loading-ring" />
                    <p>Finding your next city…</p>
                  </div>
                )}
                {round && !mapReady && !mapError && (
                  <div className="map-loading" role="status">
                    <span className="loading-ring" />
                    <p>Unfolding the map…</p>
                  </div>
                )}
                {mapError && (
                  <div className="map-loading map-error" role="alert">
                    <p>{mapError}</p>
                    <button onClick={nextRound}>Try another city</button>
                  </div>
                )}
              </div>
            </section>

            <aside className="guess-panel" aria-label="City guesses">
              <div
                className="attempt-progress"
                role="img"
                aria-label={
                  playing || !round
                    ? `${remaining} ${remaining === 1 ? "guess" : "guesses"} left out of ${MAX_GUESSES}`
                    : won
                      ? `Solved in ${round.guesses.length} attempts`
                      : "Round over"
                }
              >
                {Array.from({ length: MAX_GUESSES }, (_, index) => {
                  const guess = round?.guesses[index];
                  const state = guess
                    ? guess.correct
                      ? "correct"
                      : "used"
                    : (playing || !round) &&
                        index === (round?.guesses.length ?? 0)
                      ? "current"
                      : "remaining";
                  return (
                    <span
                      key={index}
                      className={`attempt-progress__bar attempt-progress__bar--${state}`}
                      aria-hidden="true"
                    />
                  );
                })}
              </div>
              <p className="current-hint" aria-live="polite" aria-atomic="true">
                {STAGE_HINTS[stage]}
              </p>

              {playing || !round ? (
                <form onSubmit={handleGuess} className="guess-form">
                  <CitySearch
                    selected={selected}
                    onSelect={setSelected}
                    disabled={!mapReady || !playing || !!mapError}
                    resetKey={`${roundNumber}-${round?.guesses.length ?? 0}`}
                  />
                  <div className="guess-actions">
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={!selected || !mapReady || !playing || !!mapError}
                    >
                      Guess <Icon name="arrow" />
                    </button>
                    <button
                      className="skip-button"
                      type="button"
                      onClick={handleSkip}
                      disabled={!mapReady || !playing || !!mapError || stage >= MAX_STAGE}
                      aria-label="Skip to next clue"
                      title={stage >= MAX_STAGE ? "No more clues" : "Use one attempt to reveal the next clue"}
                    >
                      Skip
                    </button>
                  </div>
                </form>
              ) : (
                <div className={`answer-card ${won ? "won" : ""}`}>
                  <span className="answer-overline">
                    {won
                      ? `FOUND IN ${round.guesses.length} ${round.guesses.length === 1 ? "ATTEMPT" : "ATTEMPTS"}`
                      : "THE CITY WAS"}
                  </span>
                  <h3>{round.city.label}</h3>
                  <p>{cityContext(round.city)}</p>
                  <button className="primary-button" onClick={nextRound}>
                    Explore another city <Icon name="arrow" />
                  </button>
                </div>
              )}

              <p
                className="sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {message}
              </p>

              {!!round?.guesses.length && (
                <section
                  className="guess-history"
                  aria-label="Previous attempts"
                >
                  <h3>Attempts</h3>
                  <ol>
                    {round.guesses.map((guess, index) => (
                      <li key={guess.skipped ? `skip-${index}` : guess.id}>
                        <span className="guess-number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="guess-place">
                          {guess.skipped ? "Skipped" : guess.name}
                          {!guess.skipped && <small>{cityContext(guess)}</small>}
                          {!guess.correct && guess.hint && (
                            <span
                              className="guess-hint"
                              role="img"
                              aria-label={`The correct city is ${guess.hint.distanceKm < 1 ? "less than 1 kilometer" : `approximately ${Math.round(guess.hint.distanceKm).toLocaleString("en-US")} kilometers`}${guess.hint.directionName ? ` ${guess.hint.directionName}` : ""} from this guess, by straight-line distance.`}
                            >
                              {guess.hint.direction && (
                                <>
                                  <svg
                                    className="guess-bearing"
                                    viewBox="0 0 20 20"
                                    aria-hidden="true"
                                    style={{
                                      transform: `rotate(${guess.hint.bearingDegrees}deg)`,
                                    }}
                                  >
                                    <path d="M10 3v14M5 8l5-5 5 5" />
                                  </svg>
                                  <span aria-hidden="true">
                                    {guess.hint.direction}
                                  </span>
                                  <span
                                    className="hint-separator"
                                    aria-hidden="true"
                                  >
                                    ·
                                  </span>
                                </>
                              )}
                              <span aria-hidden="true">
                                {formatDistanceKm(guess.hint.distanceKm)}
                              </span>
                            </span>
                          )}
                        </span>
                        <span
                          className={
                            guess.correct ? "guess-check" : guess.skipped ? "guess-skip" : "guess-cross"
                          }
                          aria-label={guess.correct ? "Correct" : guess.skipped ? "Skipped" : "Incorrect"}
                        >
                          {guess.correct ? "✓" : guess.skipped ? "—" : "×"}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {playing && (
                <button
                  className="give-up"
                  onClick={handleGiveUp}
                  disabled={!mapReady || !!mapError}
                >
                  Reveal the city
                </button>
              )}
            </aside>
          </div>
        )}
      </main>
      <footer className="site-footer">
        <p>
          Map data:{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap contributors
          </a>{" "}
          via{" "}
          <a href="https://overturemaps.org/" target="_blank" rel="noreferrer">
            Overture Maps
          </a>{" "}
          (ODbL). Elevation: USGS SRTM. City names:{" "}
          <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">
            GeoNames
          </a>{" "}
          (
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY 4.0
          </a>
          ).{" "}
          {round?.city.id === 4644585 && (
            <>
              Transit:{" "}
              <a
                href="https://www.wegotransit.com/googleexport/google_transit.zip"
                target="_blank"
                rel="noreferrer"
              >
                WeGo Public Transit
              </a>
              .
            </>
          )}
        </p>
      </footer>
    </div>
  );
}
