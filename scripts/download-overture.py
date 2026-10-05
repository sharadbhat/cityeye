"""Stream a pinned Overture release using its official Python download API.

The release is already selected by the SVG generator. Reading the public S3
dataset directly avoids re-fetching the STAC release catalog for every city
and layer. Output uses the same GeoJSON writer as the official CLI.
"""

import argparse
import os
from pathlib import Path

from overturemaps.core import record_batch_reader
from overturemaps.writers import copy, get_writer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bbox", required=True)
    parser.add_argument("--type", required=True, choices=["segment", "water", "land_use"])
    parser.add_argument("--release", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    bbox = tuple(float(value) for value in args.bbox.split(","))
    if len(bbox) != 4 or bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
        parser.error("--bbox must be west,south,east,north")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f"{output.name}.{os.getpid()}.tmp")
    reader = record_batch_reader(
        args.type,
        bbox=bbox,
        release=args.release,
        connect_timeout=20,
        request_timeout=90,
        stac=False,
    )
    if reader is None:
        raise RuntimeError(f"Could not read Overture {args.type} for {bbox}")
    try:
        with get_writer("geojson", str(temporary), schema=reader.schema) as writer:
            copy(reader, writer)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
