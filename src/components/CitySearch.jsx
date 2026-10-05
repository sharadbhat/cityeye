import { useEffect, useId, useRef, useState } from "react";
import { cityDirectory } from "../lib/city-directory.mjs";
import { attachCitySearchDismissal, preserveSearchFocus } from "../lib/city-search-interaction.mjs";

export function cityContext(city) {
  return [city.region, city.country].filter(Boolean).join(", ");
}

export default function CitySearch({ selected, onSelect, disabled, resetKey }) {
  const listId = useId();
  const inputId = useId();
  const input = useRef(null);
  const searchRoot = useRef(null);
  const cache = useRef(new Map());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle");

  useEffect(() => attachCitySearchDismissal(searchRoot.current, () => setOpen(false)), []);

  useEffect(() => {
    setQuery("");
    setResults([]);
    setOpen(false);
    setStatus("idle");
    input.current?.focus({ preventScroll: true });
  }, [resetKey]);

  useEffect(() => {
    if (!disabled) input.current?.focus({ preventScroll: true });
  }, [disabled]);

  useEffect(() => {
    if (selected || disabled || query.trim().length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    setResults([]);
    const timer = setTimeout(async () => {
      try {
        const key = query.trim();
        let suggestions = cache.current.get(key);
        if (!suggestions) {
          suggestions = await cityDirectory.search(key, 8);
          if (controller.signal.aborted) return;
          if (cache.current.size >= 50)
            cache.current.delete(cache.current.keys().next().value);
          cache.current.set(key, suggestions);
        }
        if (!controller.signal.aborted) {
          setResults(suggestions);
          setActive(0);
          setStatus("ready");
        }
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, selected, disabled]);

  const choose = (city) => {
    onSelect(city);
    setQuery(city.name);
    setOpen(false);
    input.current?.focus({ preventScroll: true });
  };
  const showList = open && !selected && query.trim().length >= 2 && !disabled;
  const handleKey = (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!showList) {
        setOpen(true);
        setActive(0);
      } else if (results.length)
        setActive(
          (current) =>
            (current + (event.key === "ArrowDown" ? 1 : -1) + results.length) %
            results.length,
        );
    }
    if (event.key === "Enter" && showList && results[active]) {
      event.preventDefault();
      choose(results[active]);
    }
  };

  return (
    <div className="city-search" ref={searchRoot}>
      <label htmlFor={inputId}>Which city is this?</label>
      <div className="search-input">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          id={inputId}
          ref={input}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck="false"
          placeholder="Search any city…"
          value={query}
          disabled={disabled}
          maxLength={100}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={
            showList && results[active] ? `${listId}-${active}` : undefined
          }
          aria-describedby={`${inputId}-hint`}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            onSelect(null);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={handleKey}
        />
        {selected && (
          <span className="selected-check" aria-label="City selected">
            ✓
          </span>
        )}
      </div>
      <p className="search-hint" id={`${inputId}-hint`}>
        {selected ? cityContext(selected) : ""}
      </p>
      {showList && (
        <div className="suggestion-popover">
          {status === "loading" && (
            <p className="search-state" role="status">
              Searching worldwide…
            </p>
          )}
          {status === "error" && (
            <p className="search-state" role="alert">
              City search is unavailable. Edit your search to try again.
            </p>
          )}
          {status === "ready" && !results.length && (
            <p className="search-state" role="status">
              No cities found. Try another spelling.
            </p>
          )}
          <ul id={listId} role="listbox" aria-label="City suggestions">
            {results.map((city, index) => (
              <li
                key={city.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={active === index}
                className={active === index ? "active" : ""}
                onPointerDown={preserveSearchFocus}
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") setActive(index);
                }}
                onClick={() => choose(city)}
              >
                <span>{city.name}</span>
                <small>{cityContext(city)}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
