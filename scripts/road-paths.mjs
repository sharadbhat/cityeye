// Join connected segments within one road style, preserving junctions and all edges.
// Coordinates are snapped only for matching endpoints, never moved in the output.
export function joinRoadSegments(roads) {
  const groups = new Map();
  for (const road of roads) {
    if (road.geometry.length < 2) continue;
    const kind = roadKind(road.tags.highway);
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(road.geometry);
  }
  return ['local', 'arterial', 'motorway'].flatMap((kind) => {
    const segments = groups.get(kind);
    if (!segments) return [];
    const endpoints = new Map();
    const key = (point) => `${point.lon.toFixed(7)},${point.lat.toFixed(7)}`;
    segments.forEach((points, index) => {
      for (const point of [points[0], points.at(-1)]) {
        const endpoint = key(point);
        if (!endpoints.has(endpoint)) endpoints.set(endpoint, []);
        endpoints.get(endpoint).push(index);
      }
    });
    const visited = new Set();
    const lines = [];
    const trace = (start, endpoint) => {
      let index = start;
      const line = [];
      while (!visited.has(index)) {
        visited.add(index);
        const segment = segments[index];
        const points = key(segment[0]) === endpoint ? segment : [...segment].reverse();
        line.push(...points.slice(line.length ? 1 : 0));
        endpoint = key(points.at(-1));
        const adjacent = endpoints.get(endpoint);
        if (adjacent.length !== 2) break;
        const next = adjacent.find((candidate) => !visited.has(candidate));
        if (next === undefined) break;
        index = next;
      }
      lines.push(line);
    };
    // Start at ends/junctions first; trace remaining closed loops afterward.
    segments.forEach((points, index) => {
      if (visited.has(index)) return;
      const first = key(points[0]);
      const last = key(points.at(-1));
      if (endpoints.get(first).length !== 2) trace(index, first);
      else if (endpoints.get(last).length !== 2) trace(index, last);
    });
    segments.forEach((points, index) => {
      if (!visited.has(index)) trace(index, key(points[0]));
    });
    return [{ kind, lines }];
  });
}

export function roadKind(highway) {
  if (['motorway', 'trunk'].includes(highway)) return 'motorway';
  if (['primary', 'secondary'].includes(highway)) return 'arterial';
  return 'local';
}
