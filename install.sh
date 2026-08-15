#!/bin/bash
set -euo pipefail

# 1. Go to the "python" directory
echo "Changing directory to './python'"
cd "$(dirname "$0")/python"

# 2. Setup virtual environment
if ! command -v python3 >/dev/null; then
  echo "python3 is not installed" >&2
  exit 1
fi

# The "<major>.<minor>" version of an interpreter.
pythonVersion() {
  "$1" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null
}

systemVersion=$(pythonVersion python3)

if [ ! -d .venv ]; then
  rebuildReason="no environment present"
elif [ "$(pythonVersion .venv/bin/python)" != "$systemVersion" ]; then
  rebuildReason="environment does not match Python $systemVersion"
else
  rebuildReason=""
fi

if [ -n "$rebuildReason" ]; then
  echo "Creating a new Python virtual environment (.venv): $rebuildReason"
  python3 -m venv --clear .venv
else
  echo "Python virtual environment is usable (Python $systemVersion)"
fi

# 3. Install the Python dependencies
echo "Installing the Python dependencies in 'requirements.txt'"
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
