"""pytest configuration for the plan-validator scripts.

Puts this directory on sys.path so `import validate_plan` resolves under every
pytest import mode (prepend does it implicitly; importlib does not) and from
any working directory.
"""

import sys
from pathlib import Path

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
