import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import subprocess
import sys
import unittest

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).with_name('receive-quality-secret.py'))
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class SecretStorageTests(unittest.TestCase):
    def test_private_atomic_replacement_and_no_shared_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = receiver.save_secret('openai', 'sk-synthetic-only-first-value', root)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(target.parent.stat().st_mode & 0o777, 0o700)
            receiver.save_secret('openai', 'sk-synthetic-only-replacement', root)
            self.assertEqual(target.read_text().strip(), 'sk-synthetic-only-replacement')
            self.assertEqual(len(list(target.parent.iterdir())), 1)

    def test_supadata_uses_separate_private_file_and_preserves_other_key(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = receiver.save_secret('openai', 'sk-synthetic-only-original', root)
            target = receiver.save_secret('supadata', 'synthetic-only-supadata-value', root)
            self.assertEqual(target.name, 'supadata.key')
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(original.read_text().strip(), 'sk-synthetic-only-original')
            for invalid in ['short', 'synthetic invalid whitespace']:
                with self.assertRaises(ValueError):
                    receiver.save_secret('supadata', invalid, root)
            self.assertEqual(target.read_text().strip(), 'synthetic-only-supadata-value')

    def test_invalid_input_does_not_replace_existing_key(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = receiver.save_secret('openai', 'sk-synthetic-only-first-value', root)
            before = target.read_bytes()
            with self.assertRaises(ValueError):
                receiver.save_secret('openai', 'invalid\nvalue', root)
            self.assertEqual(target.read_bytes(), before)

    def test_expired_access_is_rejected(self):
        for expiry, valid in [(time.time() - 10, False), (time.time() + 600, True)]:
            body = base64.urlsafe_b64encode(json.dumps({'exp': expiry}).encode()).decode().rstrip('=')
            value = f'synthetic.{body}.signature'
            if valid:
                receiver.validate('access', value)
            else:
                with self.assertRaises(ValueError):
                    receiver.validate('access', value)

    def test_symlink_destination_is_not_followed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            directory = root / 'credentials'
            directory.mkdir(mode=0o700)
            victim = root / 'untouched'
            victim.write_text('original')
            (directory / 'openai-nonprod.key').symlink_to(victim)
            with self.assertRaises(ValueError):
                receiver.save_secret('openai', 'sk-synthetic-only-first-value', root)
            self.assertEqual(victim.read_text(), 'original')

    def test_non_tty_input_is_rejected_without_echoing_value(self):
        value = 'sk-synthetic-only-piped-value'
        result = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('receive-quality-secret.py')), 'openai'],
                                input=value, text=True, capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(value, result.stdout + result.stderr)

    def test_shared_root_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            os.chmod(folder, 0o755)
            with self.assertRaises(ValueError):
                receiver.save_secret('openai', 'sk-synthetic-only-first-value', Path(folder))


if __name__ == '__main__':
    unittest.main()
