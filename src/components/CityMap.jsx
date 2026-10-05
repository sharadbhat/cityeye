import { useEffect, useRef, useState } from 'react';
import { createMapController, parseMapSvg } from '../lib/map-controller.mjs';
import './city-map.css';

export default function CityMap({ svgUrl, stage = 1, geographyClue, onReady, onError }) {
  const viewportRef = useRef(null);
  const surfaceRef = useRef(null);
  const controllerRef = useRef(null);
  const stageRef = useRef(stage);
  const callbacksRef = useRef({ onReady, onError });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  stageRef.current = stage;
  callbacksRef.current = { onReady, onError };

  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    const surface = surfaceRef.current;
    const viewport = viewportRef.current;
    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    const motionPreferenceChanged = () => {
      if (reducedMotion?.matches) controllerRef.current?.showStage(stageRef.current, true);
    };
    reducedMotion?.addEventListener?.('change', motionPreferenceChanged);
    controllerRef.current?.dispose();
    controllerRef.current = null;
    surface.replaceChildren();
    setLoading(true);
    setError('');
    callbacksRef.current.onReady?.(false);
    callbacksRef.current.onError?.('');

    async function load() {
      try {
        const response = await fetch(svgUrl, { signal: abort.signal });
        if (!response.ok) throw new Error(`Map download failed (${response.status}).`);
        const source = await response.text();
        if (!active) return;
        const { svg, config } = parseMapSvg(source);
        if (!active) return;
        const controller = createMapController({
          svg, config, surface, viewport, reducedMotion: () => Boolean(reducedMotion?.matches),
        });
        surface.replaceChildren(svg);
        controllerRef.current = controller;
        controller.showStage(stageRef.current, true);
        setLoading(false);
        callbacksRef.current.onReady?.(true);
      } catch (cause) {
        if (!active || cause.name === 'AbortError') return;
        controllerRef.current?.dispose();
        controllerRef.current = null;
        surface.replaceChildren();
        const message = cause instanceof Error ? cause.message : 'Unable to load this map.';
        setError(message);
        setLoading(false);
        callbacksRef.current.onReady?.(false);
        callbacksRef.current.onError?.(message);
      }
    }
    load();
    return () => {
      active = false;
      abort.abort();
      reducedMotion?.removeEventListener?.('change', motionPreferenceChanged);
      controllerRef.current?.dispose();
      controllerRef.current = null;
      surface.replaceChildren();
    };
  }, [svgUrl]);

  useEffect(() => {
    try {
      controllerRef.current?.showStage(stage);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to reveal this map stage.';
      setError(message);
      callbacksRef.current.onReady?.(false);
      callbacksRef.current.onError?.(message);
    }
  }, [stage]);

  return (
    <div ref={viewportRef} className="city-map" aria-busy={loading}>
      <div ref={surfaceRef} className="city-map__surface" />
      {!loading && !error && geographyClue && (
        <div key={geographyClue.label} className="city-map__geography-clue" role="status" aria-live="polite" aria-atomic="true">
          <span className="sr-only">{geographyClue.label}: </span>
          <span className="city-map__clue-value">{geographyClue.value}</span>
          {geographyClue.continent && (
            <span className="city-map__clue-continent">
              <span className="sr-only">Continent: </span>
              {geographyClue.continent}
            </span>
          )}
        </div>
      )}
      {loading && <div className="city-map__message" role="status"><span className="city-map__loader" aria-hidden="true" />Loading map…</div>}
      {error && <div className="city-map__message city-map__message--error" role="alert">This map couldn’t load. Please try a new round.</div>}
    </div>
  );
}
