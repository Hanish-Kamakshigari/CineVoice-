import os
import unittest
from unittest import mock

from editor_server import _origin_allowed


class OriginPolicyTests(unittest.TestCase):
    def test_loopback_host_without_origin(self):
        self.assertTrue(_origin_allowed("127.0.0.1:8080", None))
        self.assertTrue(_origin_allowed("localhost:8080", ""))

    def test_local_page_origins_allowed(self):
        self.assertTrue(_origin_allowed("localhost:8080", "http://localhost:5500"))
        self.assertTrue(_origin_allowed("127.0.0.1:8080", "http://127.0.0.1:8080"))
        self.assertTrue(_origin_allowed("127.0.0.1:8080", "null"))

    def test_hosted_studio_allowed(self):
        self.assertTrue(_origin_allowed("127.0.0.1:8080", "https://cine-voice-puce.vercel.app"))
        self.assertTrue(_origin_allowed("127.0.0.1:8080", "https://cine-voice-puce.vercel.app/"))

    def test_unrelated_origin_refused(self):
        self.assertFalse(_origin_allowed("127.0.0.1:8080", "https://evil.example.com"))

    def test_secure_localhost_origin_refused(self):
        self.assertFalse(_origin_allowed("127.0.0.1:8080", "https://localhost:8080"))

    def test_non_loopback_host_refused(self):
        self.assertFalse(_origin_allowed("10.0.0.5:8080", "http://localhost:5500"))

    def test_env_adds_origins(self):
        with mock.patch.dict(os.environ, {"CINEVOICE_ALLOWED_ORIGINS": "https://studio.example.com, https://alt.example.com/"}):
            self.assertTrue(_origin_allowed("127.0.0.1:8080", "https://studio.example.com"))
            self.assertTrue(_origin_allowed("127.0.0.1:8080", "https://alt.example.com"))
            self.assertFalse(_origin_allowed("127.0.0.1:8080", "https://cine-voice-puce.vercel.app"))


if __name__ == "__main__":
    unittest.main()
