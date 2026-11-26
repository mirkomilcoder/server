import sys
from pathlib import Path

# make `import mirkomil` work without installing anything
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "agent"))
