"""Strict .cube parser and helpers used by the colorist tests."""
from __future__ import annotations

import re
from typing import Dict, List, Tuple

import numpy as np


class CubeError(ValueError):
    """Raised when a .cube file does not follow the Iridas/Adobe spec."""


def parse_cube(text: str) -> Dict[str, object]:
    """Parse a .cube file strictly.

    Supports the 3D form (``LUT_3D_SIZE``) and the 1D form
    (``LUT_1D_SIZE`` + ``LUT_1D_INPUT_RANGE``). Any unknown keyword or a
    malformed data row raises :class:`CubeError`.
    """
    result: Dict[str, object] = {
        "title": "",
        "size": None,
        "size_1d": None,
        "domain_min": (0.0, 0.0, 0.0),
        "domain_max": (1.0, 1.0, 1.0),
        "input_range": None,
        "data": [],
    }
    data: List[Tuple[float, float, float]] = []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        keyword = parts[0].upper()
        if keyword == "TITLE":
            title = line[len(parts[0]) :].strip()
            result["title"] = title.strip('"')
            continue
        if keyword in {"LUT_3D_SIZE", "LUT_1D_SIZE"}:
            try:
                size = int(parts[1])
            except (IndexError, ValueError) as exc:
                raise CubeError(f"line {number}: invalid {keyword}") from exc
            if size < 2:
                raise CubeError(f"line {number}: {keyword} must be at least 2")
            result["size" if keyword == "LUT_3D_SIZE" else "size_1d"] = size
            continue
        if keyword in {"DOMAIN_MIN", "DOMAIN_MAX"}:
            if len(parts) < 4:
                raise CubeError(f"line {number}: {keyword} needs three values")
            try:
                values = tuple(float(part) for part in parts[1:4])
            except ValueError as exc:
                raise CubeError(f"line {number}: {keyword} is not numeric") from exc
            result["domain_min" if keyword == "DOMAIN_MIN" else "domain_max"] = values
            continue
        if keyword == "LUT_1D_INPUT_RANGE":
            if len(parts) < 3:
                raise CubeError(f"line {number}: LUT_1D_INPUT_RANGE needs two values")
            try:
                result["input_range"] = tuple(float(part) for part in parts[1:3])
            except ValueError as exc:
                raise CubeError(f"line {number}: LUT_1D_INPUT_RANGE is not numeric") from exc
            continue
        if keyword in {"LUT_3D_INPUT_RANGE", "DOMAIN_MIN_3D"}:
            continue
        if not re.fullmatch(r"[-+0-9.eE]+", parts[0]):
            raise CubeError(f"line {number}: unknown keyword {parts[0]!r}")
        if len(parts) != 3:
            raise CubeError(f"line {number}: data row needs three values")
        try:
            data.append(tuple(float(part) for part in parts))
        except ValueError as exc:
            raise CubeError(f"line {number}: data row is not numeric") from exc
    result["data"] = data
    return result


def apply_cube(cube: Dict[str, object], rgb: Tuple[float, float, float]) -> Tuple[float, float, float]:
    """Apply a parsed 3D cube with trilinear interpolation.

    ``.cube`` files store the red index fastest, so the flat data reshapes to
    ``table[blue][green][red]``.
    """
    size = int(cube["size"])
    table = np.array(cube["data"], dtype=np.float64).reshape(size, size, size, 3)
    position = []
    for channel in range(3):
        low = float(cube["domain_min"][channel])
        high = float(cube["domain_max"][channel])
        value = (rgb[channel] - low) / max(high - low, 1e-9) * (size - 1)
        value = float(np.clip(value, 0.0, size - 1))
        position.append(value)
    r, g, b = position
    r0, r1 = int(np.floor(r)), int(min(np.ceil(r), size - 1))
    g0, g1 = int(np.floor(g)), int(min(np.ceil(g), size - 1))
    b0, b1 = int(np.floor(b)), int(min(np.ceil(b), size - 1))
    fr, fg, fb = r - r0, g - g0, b - b0

    def blend(r0, r1, g0, g1, b0, b1, wr, wg, wb):
        return (
            table[b0, g0, r0] * (1 - wr) * (1 - wg) * (1 - wb)
            + table[b0, g0, r1] * wr * (1 - wg) * (1 - wb)
            + table[b0, g1, r0] * (1 - wr) * wg * (1 - wb)
            + table[b0, g1, r1] * wr * wg * (1 - wb)
            + table[b1, g0, r0] * (1 - wr) * (1 - wg) * wb
            + table[b1, g0, r1] * wr * (1 - wg) * wb
            + table[b1, g1, r0] * (1 - wr) * wg * wb
            + table[b1, g1, r1] * wr * wg * wb
        )

    return tuple(
        float(value)
        for value in blend(r0, r1, g0, g1, b0, b1, fr, fg, fb)
    )
