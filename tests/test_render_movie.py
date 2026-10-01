import os
import tempfile
import unittest

import render_movie


class RenderMovieTests(unittest.TestCase):
    def test_repository_paths_are_independent_of_cwd(self):
        original = os.getcwd()
        try:
            with tempfile.TemporaryDirectory() as other_cwd:
                os.chdir(other_cwd)
                self.assertTrue(render_movie.ASSETS_DIR.startswith(render_movie.REPO_ROOT))
                self.assertTrue(render_movie.MASTER_SOUNDTRACK.startswith(render_movie.REPO_ROOT))
                self.assertTrue(render_movie._vo_signature_path().startswith(render_movie.REPO_ROOT))
                os.chdir(original)
        finally:
            os.chdir(original)

    def test_render_temp_path_requires_initialized_directory(self):
        original = render_movie.TEMP_RENDER_DIR
        try:
            render_movie.TEMP_RENDER_DIR = None
            with self.assertRaises(RuntimeError):
                render_movie._temp_render_path("video.mp4")
        finally:
            render_movie.TEMP_RENDER_DIR = original

    def test_voice_signature_changes_when_script_changes(self):
        original_scenes = render_movie.SCENES
        try:
            render_movie.SCENES = [{"id": 1, "vo": "first"}]
            first = render_movie.compute_vo_signature()
            render_movie.SCENES[0]["vo"] = "second"
            second = render_movie.compute_vo_signature()
            self.assertNotEqual(first, second)
        finally:
            render_movie.SCENES = original_scenes


if __name__ == "__main__":
    unittest.main()
