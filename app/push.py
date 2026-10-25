"""Phone notifications (Web Push) for the family chat.

The server's own key (VAPID) is made on first use and kept in DATA_DIR (back it up with the chat: a new key
means every device has to switch notifications on again). Each message is encrypted for the device
(RFC 8291, http-ece) and sent to its browser's push service, which can't read it.
"""
import base64
import logging
import pathlib
import time
import urllib.parse

import http_ece
import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid02
from py_vapid.utils import b64urlencode

# Devices send the address to push to; only real push services are accepted, so nobody can make the server
# send requests elsewhere (Chrome/Android/Samsung/Opera, Chromium (jmt17.google.com), Firefox, Safari/iPhone, Edge on Windows).
PUSH_HOSTS = ("fcm.googleapis.com", ".google.com", ".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com")
TRANSPORT = None  # the tests swap in a fake push service here
log = logging.getLogger("easy-gramps")


def push_address(url) -> bool:
    if not isinstance(url, str):
        return False
    try:
        u = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h or (h[0] == "." and host.endswith(h)) for h in PUSH_HOSTS)


def b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class Push:
    def __init__(self, path: pathlib.Path):
        self.path = path
        self._key = None

    def key(self) -> Vapid02:
        if self._key is None:
            if self.path.exists():
                self._key = Vapid02.from_file(str(self.path))
            else:
                k = Vapid02()
                k.generate_keys()
                self.path.parent.mkdir(parents=True, exist_ok=True)
                k.save_key(str(self.path))
                self.path.chmod(0o600)
                self._key = k
        return self._key

    def public_key(self) -> str:
        """For the page's pushManager.subscribe()."""
        raw = self.key().public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        return b64urlencode(raw)

    def request(self, device: dict, data: bytes, contact: str) -> tuple[str, dict, bytes]:
        """The encrypted request for one device: (address, headers, body)."""
        body = http_ece.encrypt(data, private_key=ec.generate_private_key(ec.SECP256R1()), dh=b64d(device["keys"]["p256dh"]),
                                auth_secret=b64d(device["keys"]["auth"]), version="aes128gcm")
        u = urllib.parse.urlsplit(device["endpoint"])
        headers = self.key().sign({"aud": f"{u.scheme}://{u.netloc}", "sub": contact, "exp": int(time.time()) + 12 * 3600})
        headers.update({"TTL": "86400", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream"})
        return device["endpoint"], headers, body

    async def send(self, devices: list[dict], data: bytes, contact: str) -> list[str]:
        """Send to every device; returns the addresses the push service says are gone (to forget)."""
        gone = []
        async with httpx.AsyncClient(timeout=15, transport=TRANSPORT) as http:
            for d in devices:
                if not push_address(d["endpoint"]):
                    continue
                url, headers, body = self.request(d, data, contact)
                try:
                    r = await http.post(url, headers=headers, content=body)
                except httpx.HTTPError as e:  # one device's trouble mustn't stop the others
                    log.warning("Notification to %s failed: %s", urllib.parse.urlsplit(url).hostname, e)
                    continue
                if r.status_code in (404, 410):
                    gone.append(url)
                elif r.status_code >= 400:
                    log.warning("Notification to %s refused: %s %s", urllib.parse.urlsplit(url).hostname, r.status_code, r.text[:200])
        return gone
