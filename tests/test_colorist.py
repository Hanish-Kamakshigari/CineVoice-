"""Tests for the CineVoice AI Colorist engine."""
from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import video_colorist as vc  # noqa: E402


def synthetic_frame(width=160, height=90, luma=0.45, cast=(1.0, 1.0, 1.0), noise=0.0, seed=3):
    """Build a flat RGB frame with a controlled level, cast and noise."""
    rng = np.random.default_rng(seed)
    base = np.array([luma * c for c in cast], dtype=np.float32)
    frame = np.ones((height, width, 3), dtype=np.float32) * base
    if noise:
        frame = frame + rng.normal(0.0, noise, frame.shape).astype(np.float32)
    return np.clip(frame * 255.0, 0, 255).astype(np.uint8)


class CurveTests(unittest.TestCase):
    def test_curve_is_monotonic_and_bounded(self):
        grade = vc._blank_grade(vc.PRESETS["cinematic"])
        grade["exposure"] = 0.4
        grade["shadow_lift"] = 0.02
        for channel in range(3):
            samples = vc.channel_curve(grade, channel)
            self.assertEqual(len(samples), vc.CURVE_POINTS)
            values = [value for _, value in samples]
            self.assertTrue(all(0.0 <= v <= 1.0 for v in values))
            self.assertTrue(all(b >= a for a, b in zip(values, values[1:])), "curve must not invert")

    def test_exposure_pushes_midtones_up(self):
        grade = vc._blank_grade(vc.PRESETS["cinematic"])
        neutral = vc.channel_curve(grade, 1)
        grade["exposure"] = 0.5
        lifted = vc.channel_curve(grade, 1)
        self.assertGreater(lifted[len(lifted) // 2][1], neutral[len(neutral) // 2][1])

    def test_saturation_matrix_preserves_grey(self):
        for saturation in (0.0, 0.8, 1.0, 1.2):
            matrix = vc.saturation_matrix(saturation)
            self.assertAlmostEqual(matrix["rr"] + matrix["rg"] + matrix["rb"], 1.0, places=6)
            self.assertAlmostEqual(matrix["gr"] + matrix["gg"] + matrix["gb"], 1.0, places=6)
            self.assertAlmostEqual(matrix["br"] + matrix["bg"] + matrix["bb"], 1.0, places=6)

    def test_saturation_matrix_is_identity_at_one(self):
        matrix = vc.saturation_matrix(1.0)
        self.assertAlmostEqual(matrix["rr"], 1.0, places=6)
        self.assertAlmostEqual(matrix["rg"], 0.0, places=6)
        self.assertAlmostEqual(matrix["gb"], 0.0, places=6)

    def test_saturation_matrix_is_luma_at_zero(self):
        matrix = vc.saturation_matrix(0.0)
        self.assertAlmostEqual(matrix["rr"], vc.LR, places=6)
        self.assertAlmostEqual(matrix["gg"], vc.LG, places=6)
        self.assertAlmostEqual(matrix["bb"], vc.LB, places=6)

    def test_lut_matches_the_transfer_function(self):
        grade = vc._blank_grade(vc.PRESETS["cinematic"])
        grade["exposure"] = 0.25
        grade["contrast"] = 1.1
        grade["saturation"] = 1.05
        curve = vc.channel_curve(grade, 0, points=256)
        matrix = vc.saturation_matrix(grade["saturation"])
        for value in (0.0, 0.25, 0.5, 0.75, 1.0):
            expected = float(np.interp([value], [p[0] for p in curve], [p[1] for p in curve])[0])
            grey = matrix["rr"] * expected + matrix["rg"] * expected + matrix["rb"] * expected
            self.assertAlmostEqual(grey, expected, places=6)


class LUTTests(unittest.TestCase):
    def test_cube_lut_header_and_range(self):
        grade = vc._blank_grade(vc.PRESETS["cinematic"])
        text = vc.bake_cube_lut(grade, size=9)
        lines = text.strip().splitlines()
        self.assertIn("LUT_3D_SIZE 9", lines)
        self.assertIn("DOMAIN_MIN 0.0 0.0 0.0", lines)
        self.assertIn("DOMAIN_MAX 1.0 1.0 1.0", lines)
        values = [line for line in lines[4:] if line.strip()]
        self.assertEqual(len(values), 9 ** 3)
        for line in values:
            parts = [float(part) for part in line.split()]
            self.assertEqual(len(parts), 3)
            for part in parts:
                self.assertGreaterEqual(part, 0.0)
                self.assertLessEqual(part, 1.0)

    def test_one_dimensional_lut_header(self):
        grade = vc._blank_grade(vc.PRESETS["cinematic"])
        text = vc.bake_1d_cube_lut(grade, size=64)
        self.assertIn("LUT_1D_SIZE 64", text)
        self.assertIn("LUT_1D_INPUT_RANGE 0.0 1.0", text)

    def test_one_dimensional_lut_matches_the_analytic_curve(self):
        grade = vc._blank_grade(vc.PRESETS["cinematic"])
        grade["exposure"] = 0.3
        grade["shadow_lift"] = 0.02
        text = vc.bake_1d_cube_lut(grade, size=65)
        rows = [line for line in text.strip().splitlines()[4:] if line.strip()]
        self.assertEqual(len(rows), 65)
        curve = vc.channel_curve(grade, 1, points=256)
        xs = [p[0] for p in curve]
        ys = [p[1] for p in curve]
        for index, row in enumerate(rows):
            value = index / 64.0
            expected = float(np.interp([value], xs, ys)[0])
            self.assertAlmostEqual(float(row.split()[1]), expected, places=5)

    def test_three_dimensional_lut_matches_the_ffmpeg_chain(self):
        # The FFmpeg chain is curves -> colorchannelmixer, and the cube bakes
        # exactly that, so a sampled grid point must reproduce the same maths.
        grade = vc._blank_grade(vc.PRESETS["cinematic"])
        grade["exposure"] = 0.2
        size = 17
        cube_rows = [
            line for line in vc.bake_cube_lut(grade, size=size).strip().splitlines()[5:]
            if line.strip()
        ]
        curves = [vc.channel_curve(grade, channel, points=256) for channel in range(3)]
        matrix = vc.saturation_matrix(grade["saturation"])
        for index in (0, 4, 8, 12, 16):
            value = index / (size - 1)
            sampled = [
                float(np.interp([value], [p[0] for p in curve], [p[1] for p in curve])[0])
                for curve in curves
            ]
            expected = [
                matrix["rr"] * sampled[0] + matrix["rg"] * sampled[1] + matrix["rb"] * sampled[2],
                matrix["gr"] * sampled[0] + matrix["gg"] * sampled[1] + matrix["gb"] * sampled[2],
                matrix["br"] * sampled[0] + matrix["bg"] * sampled[1] + matrix["bb"] * sampled[2],
            ]
            row = [float(part) for part in cube_rows[index * size * size + index * size + index].split()]
            for channel in range(3):
                self.assertAlmostEqual(row[channel], expected[channel], places=5)

    def test_lut_is_monotonic_for_a_lifted_curve(self):
        grade = vc._blank_grade(vc.PRESETS["cinematic"])
        grade["shadow_lift"] = 0.03
        text = vc.bake_1d_cube_lut(grade, size=32)
        rows = [line for line in text.strip().splitlines()[4:] if line.strip()]
        values = [float(row.split()[1]) for row in rows]
        self.assertTrue(all(b >= a for a, b in zip(values, values[1:])))


class MeasurementTests(unittest.TestCase):
    def test_dark_frame_is_measured_as_under_exposed(self):
        stats = vc.measure_frame(synthetic_frame(luma=0.12))
        self.assertLess(stats["luma_mean"], 0.2)
        self.assertGreater(stats["black_point"], 0.05)

    def test_clipped_black_is_measured_as_crushed(self):
        frame = np.full((40, 40, 3), 4, dtype=np.uint8)
        stats = vc.measure_frame(frame)
        self.assertGreater(stats["shadow_clip"], 0.9)

    def test_skin_colour_is_detected(self):
        frame = np.zeros((40, 40, 3), dtype=np.uint8)
        frame[:, :] = (230, 180, 150)
        stats = vc.measure_frame(frame)
        self.assertGreater(stats["skin_ratio"], 0.9)

    def test_neutral_grey_has_no_cast(self):
        stats = vc.measure_frame(synthetic_frame(luma=0.45))
        self.assertLess(stats["cast"], 0.05)

    def test_blue_cast_is_detected(self):
        stats = vc.measure_frame(synthetic_frame(luma=0.45, cast=(0.7, 0.85, 1.0)))
        self.assertGreater(stats["cast"], 0.1)

    def test_noise_is_measured(self):
        clean = vc.measure_frame(synthetic_frame(luma=0.45, noise=0.0, seed=1))
        noisy = vc.measure_frame(synthetic_frame(luma=0.45, noise=0.05, seed=1))
        self.assertGreater(noisy["noise_sigma"], clean["noise_sigma"] * 2)


class PlanningTests(unittest.TestCase):
    def test_dark_scene_gets_exposure_and_lift(self):
        stats = vc.measure_frame(synthetic_frame(luma=0.1))
        result = vc.plan_scene(stats, "cinematic")
        self.assertGreater(result["grade"]["exposure"], 0.2)
        self.assertGreater(result["grade"]["shadow_lift"], 0.0)
        self.assertIn("under-exposed", result["issues"])

    def test_well_exposed_scene_stays_neutral(self):
        stats = vc.measure_frame(synthetic_frame(luma=0.45))
        result = vc.plan_scene(stats, "cinematic")
        self.assertAlmostEqual(result["grade"]["exposure"], 0.0, places=6)
        self.assertEqual(result["grade"]["grain"], vc.PRESETS["cinematic"]["grain"])

    def test_noisy_scene_is_denoised(self):
        stats = vc.measure_frame(synthetic_frame(luma=0.45, noise=0.06))
        result = vc.plan_scene(stats, "cinematic")
        self.assertGreater(result["grade"]["denoise_luma"], 0.0)
        self.assertGreater(result["grade"]["denoise_chroma"], result["grade"]["denoise_luma"])

    def test_ai_merge_is_clamped_to_safe_limits(self):
        base = vc._blank_grade(vc.PRESETS["cinematic"])
        merged = vc.merge_ai_plan(base, {"exposure": 5.0, "contrast": -3.0, "wb": [9, 0, 1]})
        self.assertLessEqual(merged["exposure"], base["exposure"] + 0.45)
        self.assertGreaterEqual(merged["contrast"], base["contrast"] - 0.18)
        for value in merged["wb"]:
            self.assertGreaterEqual(value, 0.88)
            self.assertLessEqual(value, 1.12)

    def test_ai_merge_keeps_valid_values(self):
        base = vc._blank_grade(vc.PRESETS["cinematic"])
        merged = vc.merge_ai_plan(base, {"exposure": 0.2, "saturation": 1.1})
        self.assertAlmostEqual(merged["exposure"], 0.2, places=6)
        self.assertAlmostEqual(merged["saturation"], 1.1, places=6)


class GraphTests(unittest.TestCase):
    def setUp(self):
        self.scenes = []
        for index in range(3):
            grade = vc._blank_grade(vc.PRESETS["cinematic"])
            grade["exposure"] = 0.1 * index
            self.scenes.append({
                "index": index,
                "start": float(index * 10),
                "end": float((index + 1) * 10),
                "duration": 10.0,
                "grade": grade,
            })

    def test_scene_graph_separates_every_branch(self):
        graph = vc.build_scene_filtergraph(self.scenes)
        self.assertIn("split=3", graph)
        self.assertIn("concat=n=3:v=1:a=0[vout]", graph)
        for index in range(3):
            self.assertIn(f"[s{index}]trim=start={index * 10}.000", graph)
            self.assertIn(f"[v{index}]", graph)
        # Every branch must be terminated, otherwise FFmpeg rejects the graph.
        self.assertEqual(graph.count("]trim="), 3)
        self.assertEqual(graph.count("format=yuv420p"), 3)

    def test_timeline_graph_gates_every_filter(self):
        graph = vc.build_timeline_filtergraph(self.scenes)
        self.assertIn("between(t,0.000,10.000)", graph)
        self.assertIn("between(t,20.000,30.000)", graph)
        self.assertTrue(graph.startswith("[0:v]format=gbrp,"))
        self.assertTrue(graph.endswith("format=yuv420p[vout]"))

    def test_generated_script_is_valid_python(self):
        script = vc.build_python_script(self.scenes, "cinematic", True)
        compile(script, "colorist_grade.py", "exec")
        self.assertIn("PLAN = json.loads", script)
        self.assertIn("concat=n=", script)

    def test_resolve_recipe_mentions_the_lut(self):
        recipe = vc.resolve_recipe("cinematic", vc._blank_grade(vc.PRESETS["cinematic"]))
        self.assertIn("cinevoice_cinematic.cube", recipe)
        self.assertIn("Grain", recipe)


class FFmpegTests(unittest.TestCase):
    def test_ffmpeg_binary_is_available(self):
        self.assertTrue(Path(vc.ffmpeg_binary()).is_file())

    def test_probe_reports_the_source_video(self):
        source = ROOT / "THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4"
        if not source.is_file():
            self.skipTest("demo film is not available")
        info = vc.probe_video(source)
        self.assertGreater(info["duration"], 10)
        self.assertGreater(info["width"], 0)
        self.assertGreater(info["height"], 0)
        self.assertTrue(info["has_audio"])

    def test_scene_detection_finds_cuts(self):
        source = ROOT / "THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4"
        if not source.is_file():
            self.skipTest("demo film is not available")
        duration = vc.probe_video(source)["duration"]
        scenes = vc.detect_scenes(source, duration=duration)
        self.assertGreaterEqual(len(scenes), 2)
        self.assertEqual(scenes[0]["start"], 0.0)
        self.assertAlmostEqual(scenes[-1]["end"], duration, places=1)
        for previous, following in zip(scenes, scenes[1:]):
            self.assertAlmostEqual(previous["end"], following["start"], places=3)


class PayloadTests(unittest.TestCase):
    def test_payload_keeps_stats_and_one_keyframe_per_scene(self):
        scenes = [{
            "index": 0,
            "start": 0.0,
            "end": 5.0,
            "duration": 5.0,
            "stats": {"luma_mean": 0.4},
            "grade": vc._blank_grade(vc.PRESETS["cinematic"]),
            "issues": ["flat contrast"],
            "actions": ["build an S-curve"],
            "keyframe": "data:image/jpeg;base64,AAA",
        }]
        report = {
            "preset": "cinematic",
            "video": {"duration": 5.0},
            "scenes": scenes,
        }
        payload = vc.build_payload(report)
        self.assertEqual(payload["preset"], "cinematic")
        self.assertEqual(len(payload["scenes"]), 1)
        self.assertEqual(payload["scenes"][0]["keyframe"], "data:image/jpeg;base64,AAA")
        self.assertIn("planned_grade", payload["scenes"][0])

    def test_report_is_json_serialisable(self):
        grade = vc._blank_grade(vc.PRESETS["cinematic"])
        report = {
            "scenes": [{
                "index": 0, "start": 0.0, "end": 1.0, "duration": 1.0,
                "grade": grade, "stats": {"luma_mean": 0.4},
            }]
        }
        json.dumps(report)


if __name__ == "__main__":
    unittest.main()
