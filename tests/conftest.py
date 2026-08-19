"""Make the project root importable so tests can `import releasebot`.

The pipeline modules live at the repo root rather than in a package, which is
fine for a script but means pytest needs the root on sys.path.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
