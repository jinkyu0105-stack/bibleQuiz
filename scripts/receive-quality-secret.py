"""Receive a local quality-trial credential via hidden TTY input only."""
import argparse
import base64
import getpass
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
import warnings

ROOT = Path.home() / '.local' / 'state' / 'biblequiz'


def private_directory(directory):
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('PRIVATE_DIRECTORY_REQUIRED')


def validate(kind, value):
    if not value or len(value) > 16384 or re.search(r'\s', value):
        raise ValueError('INVALID_SECRET')
    if kind == 'openai':
        if not value.startswith('sk-') or len(value) < 20:
            raise ValueError('INVALID_SECRET')
    elif kind == 'access':
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', value):
            raise ValueError('INVALID_SECRET')
        part = value.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))
        if not isinstance(claims, dict) or not isinstance(claims.get('exp'), (int, float)) or claims['exp'] <= time.time():
            raise ValueError('ACCESS_EXPIRED_OR_INVALID')
        # This is a format/expiry check, not signature or audience verification.
        # The unchanged app's Access middleware verifies those before any action.
    else:
        raise ValueError('INVALID_KIND')


def save_secret(kind, value, root=ROOT):
    validate(kind, value)
    private_directory(root)
    directory = root / 'credentials'
    private_directory(directory)
    target = directory / ('access.jwt' if kind == 'access' else 'openai-nonprod.key')
    if target.exists() or target.is_symlink():
        info = target.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('PRIVATE_FILE_REQUIRED')
    fd, name = tempfile.mkstemp(prefix='.credential-', dir=directory)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(value + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, target)
        dir_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return target


def main():
    parser = argparse.ArgumentParser(description='비공개 시험 인증값 저장. 값은 명령 인자나 대화에 넣지 마세요.')
    parser.add_argument('kind', choices=['access', 'openai'])
    args = parser.parse_args()
    if not sys.stdin.isatty():
        raise ValueError('TTY_REQUIRED')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        value = getpass.getpass('인증값 붙여넣기 (화면에 표시되지 않음): ').strip()
    target = save_secret(args.kind, value)
    print(f'비공개 파일 저장 완료: {target}')
    print('저장만 수행했습니다. 인증 확인이나 AI 호출은 실행하지 않았습니다.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, EOFError, KeyboardInterrupt, getpass.GetPassWarning):
        print('저장하지 못했습니다. WSL 터미널의 숨김 입력·값 형식·만료·파일 권한을 확인하세요.', file=sys.stderr)
        sys.exit(1)
