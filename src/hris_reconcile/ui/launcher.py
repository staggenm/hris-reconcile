"""Safe local-only launcher for the Streamlit application."""

import os
import sys
from pathlib import Path


def main() -> None:
    app_path = Path(__file__).with_name("app.py")
    command = [
        sys.executable,
        "-m",
        "streamlit",
        "run",
        str(app_path),
        "--server.address=127.0.0.1",
        "--server.headless=true",
        "--server.showEmailPrompt=false",
        "--browser.gatherUsageStats=false",
        "--browser.serverAddress=127.0.0.1",
    ]
    os.execv(sys.executable, command)


if __name__ == "__main__":
    main()
