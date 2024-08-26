#!/bin/bash

# 1. Go to the "python" directory
echo "Changing directory to './python'"
cd python

# 2. Setup virtual environment
if [ -d .venv ]; then
  echo "Python virtual environment exists"
else
  echo "Creating a new Python virtual environment (.venv)"
  python -m venv .venv
fi

# 3. Activate the virtual environment
echo "Activating the virtual environment"
source .venv/bin/activate

# 4. Install the Python dependencies
echo "Installing the Python dependencies in 'requirements.txt'"
python -m pip install -r requirements.txt
