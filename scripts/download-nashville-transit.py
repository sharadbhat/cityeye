"""Cache official WeGo GTFS passenger-rail shapes as line-oriented GeoJSON.

Uses Python's standard library only. The GeoJSON matches the generator's
Overture rail feature fields while keeping official route/source information.
"""

import argparse
import csv
import io
import json
import math
import os
from pathlib import Path
import sys
import urllib.request
import zipfile


FEED_URL = "https://www.wegotransit.com/googleexport/google_transit.zip"
SOURCE_DIRECTORY = Path(__file__).resolve().parents[1] / "output" / "source"
STAR_NAMES = {"star", "wego star", "music city star"}


def csv_rows(archive, filename, required=True):
    candidates = [name for name in archive.namelist() if Path(name).name == filename]
    if not candidates:
        if required:
            raise ValueError(f"Official GTFS feed has no {filename}.")
        return
    with archive.open(candidates[0]) as binary:
        with io.TextIOWrapper(binary, encoding="utf-8-sig", newline="") as text:
            yield from csv.DictReader(text)


def download_feed(cache, refresh):
    if cache.exists() and not refresh:
        print(f"Using cached official GTFS: {cache}")
        return
    cache.parent.mkdir(parents=True, exist_ok=True)
    temporary = cache.with_name(f"{cache.name}.{os.getpid()}.tmp")
    request = urllib.request.Request(FEED_URL, headers={"User-Agent": "CitySVGGenerator/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            with temporary.open("wb") as target:
                while chunk := response.read(1024 * 1024):
                    target.write(chunk)
        if not zipfile.is_zipfile(temporary):
            raise ValueError("Official GTFS URL did not return a valid ZIP archive.")
        temporary.replace(cache)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Cached official GTFS: {cache}")


def build_features(cache):
    with zipfile.ZipFile(cache) as archive:
        agencies = list(csv_rows(archive, "agency.txt", required=False))
        feed_info = list(csv_rows(archive, "feed_info.txt", required=False))
        attributions = list(csv_rows(archive, "attributions.txt", required=False))
        routes = {}
        for route in csv_rows(archive, "routes.txt"):
            names = [route.get("route_short_name", ""), route.get("route_long_name", "")]
            star_named = any(name.strip().casefold() in STAR_NAMES for name in names)
            if route.get("route_type", "").strip() == "2" or star_named:
                routes[route["route_id"]] = route
        if not routes:
            raise ValueError("Official feed contains no rail (type 2) or explicitly Star-named route.")
        for route in routes.values():
            print(f"Selected route {route['route_id']}: {route.get('route_long_name') or route.get('route_short_name')} (GTFS type {route.get('route_type')})")

        shape_routes = {}
        for trip in csv_rows(archive, "trips.txt"):
            if trip.get("route_id") in routes and trip.get("shape_id"):
                shape_routes.setdefault(trip["shape_id"], set()).add(trip["route_id"])
        if not shape_routes:
            raise ValueError("Selected official train routes have no GTFS shape IDs.")

        shapes = {shape_id: [] for shape_id in shape_routes}
        for point in csv_rows(archive, "shapes.txt"):
            shape_id = point.get("shape_id")
            if shape_id not in shapes:
                continue
            longitude = float(point["shape_pt_lon"])
            latitude = float(point["shape_pt_lat"])
            if not math.isfinite(longitude) or not math.isfinite(latitude) or not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
                raise ValueError(f"Official shape {shape_id} contains invalid coordinates.")
            shapes[shape_id].append((int(point["shape_pt_sequence"]), [longitude, latitude]))

        features = []
        for shape_id, points in sorted(shapes.items()):
            coordinates = []
            for _sequence, coordinate in sorted(points, key=lambda point: point[0]):
                if not coordinates or coordinate != coordinates[-1]:
                    coordinates.append(coordinate)
            if len(coordinates) < 2:
                raise ValueError(f"Official shape {shape_id} has fewer than two distinct points.")
            route_ids = sorted(shape_routes[shape_id])
            names = [routes[route_id].get("route_long_name") or routes[route_id].get("route_short_name") or route_id for route_id in route_ids]
            features.append({
                "type": "Feature",
                "id": f"wego-gtfs-{shape_id}",
                "geometry": {"type": "LineString", "coordinates": coordinates},
                "properties": {
                    "names": {"primary": " / ".join(names)},
                    "subtype": "rail",
                    "class": "standard_gauge",
                    "rail_flags": [],
                    "is_transit": True,
                    "shape_id": shape_id,
                    "route_ids": route_ids,
                    "route_names": names,
                    "source_dataset": "WeGo Public Transit official GTFS",
                    "source_url": FEED_URL,
                    "source_agencies": agencies,
                    "source_feed_info": feed_info,
                    "source_attributions": attributions,
                },
            })
        return features


def write_geojson(output, features):
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f"{output.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as target:
            target.write('{"type":"FeatureCollection","features":[\n')
            for index, feature in enumerate(features):
                target.write(json.dumps(feature, ensure_ascii=False, separators=(",", ":")))
                target.write(",\n" if index < len(features) - 1 else "\n")
            target.write("]}\n")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=SOURCE_DIRECTORY / "nashville-wego-gtfs.zip")
    parser.add_argument("--output", type=Path, default=SOURCE_DIRECTORY / "nashville-transit.geojson")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    download_feed(args.cache, args.refresh)
    features = build_features(args.cache)
    write_geojson(args.output, features)
    print(f"Wrote {args.output}: {len(features)} unique official passenger-rail shapes; {sum(len(feature['geometry']['coordinates']) for feature in features)} points.")
    print(f"Attribution/source: WeGo Public Transit; {FEED_URL}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Unable to obtain official Nashville passenger-rail geometry: {error}", file=sys.stderr)
        sys.exit(1)
