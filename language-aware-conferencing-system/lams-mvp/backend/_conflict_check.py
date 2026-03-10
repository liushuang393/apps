import pathlib
import py_compile
import subprocess

root = pathlib.Path("app")
lt = chr(60) * 7
eq = chr(61) * 7
gt = chr(62) * 7
conflicted = []
for p in root.rglob("*.py"):
    text = p.read_text(encoding="utf-8", errors="replace")
    if lt in text or eq in text or gt in text:
        conflicted.append(str(p))
print("conflicted files:", conflicted)
try:
    py_compile.compile("app/config.py", doraise=True)
    print("config.py compiles OK")
except Exception as e:
    print("config.py COMPILE ERROR:", type(e).__name__, e)
r = subprocess.run(
    ["git", "status", "--porcelain"], capture_output=True, text=True, cwd=".."
)
print("--- git status --porcelain (repo) ---")
print(r.stdout[:2000])
