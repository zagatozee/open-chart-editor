"""Pure-logic coverage for stem_split.py: OCE ships no separation engine, so
this is just an HTTP client of a separation server's /separate API at a URL
the user supplies - these tests cover stem-id normalization, origin/redirect
safety, and the request/response flow against a fake HTTP server (no real
network, no real separation)."""
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import stem_split as s


class NormalizeStemId(unittest.TestCase):
    def test_known_labels(self):
        for name, expected in [('drums', 'drums'), ('no_vocals', 'other'), ('bass', 'bass'), ('Guitar', 'guitar')]:
            self.assertEqual(s.normalize_stem_id(name), expected)

    def test_unrecognized_label_returns_none(self):
        self.assertIsNone(s.normalize_stem_id('mystery_track'))


class SameOrigin(unittest.TestCase):
    def test_same_scheme_host_port(self):
        self.assertTrue(s._same_origin('http://localhost:7865/download/a.wav', 'http://localhost:7865'))

    def test_different_host_is_not_same_origin(self):
        self.assertFalse(s._same_origin('http://evil.example.com/x', 'http://localhost:7865'))

    def test_default_port_is_made_explicit(self):
        self.assertTrue(s._same_origin('http://localhost:80/x', 'http://localhost'))


class SplitFullMixRequiresServerUrl(unittest.TestCase):
    def test_raises_without_a_server_url(self):
        with self.assertRaisesRegex(RuntimeError, 'No split server URL'):
            s.split_full_mix(b'abc', 'mix.wav', server_url='')


class FakeSeparateServer(BaseHTTPRequestHandler):
    """A minimal stand-in for feedBack-demucs-server's /separate + stem-download API."""
    fail_download = False

    def do_POST(self):
        if self.path.startswith('/separate'):
            length = int(self.headers.get('Content-Length', 0))
            self.rfile.read(length)
            body = json.dumps({'stems': {'drums': '/download/drums.wav', 'no_vocals': '/download/other.wav'}}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path.startswith('/download/'):
            if FakeSeparateServer.fail_download:
                self.send_response(500)
                self.end_headers()
                return
            body = b'RIFFfakepcmdata'
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        pass


class SplitFullMixAgainstFakeServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(('127.0.0.1', 0), FakeSeparateServer)
        cls.port = cls.server.server_port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        FakeSeparateServer.fail_download = False

    def test_splits_and_normalizes_stem_ids(self):
        result = s.split_full_mix(b'mix-bytes', 'mix.wav', server_url=f'http://127.0.0.1:{self.port}')
        ids = sorted(stem['id'] for stem in result['stems'])
        self.assertEqual(ids, ['drums', 'other'])  # no_vocals -> other
        self.assertEqual(result['stem_separation']['engine'], 'bs-roformer')
        for stem in result['stems']:
            self.assertEqual(stem['bytes'], b'RIFFfakepcmdata')

    def test_a_failed_stem_download_raises(self):
        FakeSeparateServer.fail_download = True
        with self.assertRaisesRegex(RuntimeError, 'stem download failed'):
            s.split_full_mix(b'mix-bytes', 'mix.wav', server_url=f'http://127.0.0.1:{self.port}')


if __name__ == '__main__':
    unittest.main()
