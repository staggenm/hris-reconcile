"""Process-wide network guard for the local reconciliation workbench."""

import ipaddress
import os
import socket
import sys
from typing import Any

_installed = False
_SOCKET_ADDRESS_EVENTS = frozenset(
    {"socket.connect", "socket.sendto", "socket.sendmsg"}
)


def _is_loopback_address(address: object) -> bool:
    if not isinstance(address, tuple) or not address:
        return False
    host = address[0]
    return _is_loopback_host(host)


def _is_loopback_host(host: object) -> bool:
    if not isinstance(host, str):
        return False
    if host.casefold() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _network_audit_hook(event: str, args: tuple[Any, ...]) -> None:
    if event == "socket.getaddrinfo":
        if not args or not _is_loopback_host(args[0]):
            os._exit(70)
        return
    if event not in _SOCKET_ADDRESS_EVENTS or len(args) < 2:
        return
    connection = args[0]
    address = args[1]
    if isinstance(connection, socket.socket) and connection.family == socket.AF_UNIX:
        return
    # A connected sendmsg may omit its destination; it opens no new channel.
    if event == "socket.sendmsg" and address is None:
        return
    if not _is_loopback_address(address):
        os._exit(70)


def install_network_tripwire() -> None:
    """Hard-abort if this process attempts a non-loopback socket connection."""
    global _installed
    if _installed:
        return
    sys.addaudithook(_network_audit_hook)
    _installed = True
