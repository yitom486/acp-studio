"""Round 2: stage only my post-bf4b227 hunks (media/widgets follow-ups).

Run from repo root:  python scripts/stage-my-changes.py
Stages via `git apply --cached`; never touches the working tree.
Fail-closed: unknown hunks, missing anchors, or teammate markers in kept
lines abort the run before anything is staged.
"""
import re
import subprocess
import sys

REPO = r"D:\project\js\Electron\antigravity-acp"

# Markers that must NEVER appear in staged +/- lines (teammates' work).
FORBIDDEN = ("TitleBar", "useThemeStore", "threadMcpServers", "mcpServers", "autoServers")


def git_diff(path: str) -> str:
    out = subprocess.run(
        ["git", "diff", "--", path], cwd=REPO, capture_output=True, text=True,
        encoding="utf-8",
    )
    if out.returncode != 0:
        print(out.stderr)
        sys.exit(1)
    return out.stdout


def parse_hunks(diff: str):
    lines = diff.split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]
    preamble, hunks, cur = [], [], None
    for ln in lines:
        if ln.startswith("@@"):
            if cur:
                hunks.append(cur)
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@(.*)$", ln)
            assert m, ln
            cur = {"old_start": int(m.group(1)), "tail": m.group(3), "lines": []}
        elif cur is None:
            preamble.append(ln)
        else:
            cur["lines"].append(ln)
    if cur:
        hunks.append(cur)
    return preamble, hunks


def render(preamble, hunks):
    out = list(preamble)
    delta = 0
    for h in hunks:
        body = [ln for ln in h["lines"]]
        old_count = sum(1 for ln in body if not ln.startswith("+") and not ln.startswith("\\"))
        new_count = sum(1 for ln in body if not ln.startswith("-") and not ln.startswith("\\"))
        new_start = h["old_start"] + delta
        out.append(f"@@ -{h['old_start']},{old_count} +{new_start},{new_count} @@{h['tail']}")
        out.extend(body)
        delta += new_count - old_count
    return "\n".join(out) + "\n"


def pm_lines(hunk):
    return [ln for ln in hunk["lines"] if ln.startswith(("+", "-")) and not ln.startswith(("+++", "---"))]


def check_no_forbidden(kept, where: str):
    for ln in kept:
        if any(m in ln for m in FORBIDDEN):
            print(f"!! forbidden marker in {where}: {ln}")
            sys.exit(1)


# ---------------- App.tsx (round 2: media wiring only) ----------------
APP_KEEP = {668, 945}
APP_MINE = ("images: m.images", "onImageChunk")


def filter_app() -> str:
    preamble, hunks = parse_hunks(git_diff("src/App.tsx"))
    kept = []
    for h in hunks:
        if h["old_start"] in APP_KEEP:
            kept.append(h)
            continue
        # dropped hunks must not carry my lines
        for ln in pm_lines(h):
            if any(a in ln for a in APP_MINE):
                print(f"!! App hunk {h['old_start']} wrongly dropped, contains: {ln}")
                sys.exit(1)
    check_no_forbidden([ln for h in kept for ln in pm_lines(h)], "App.tsx")
    # kept hunks must actually hold my lines
    blob = "\n".join(ln for h in kept for ln in pm_lines(h))
    for a in APP_MINE:
        if a not in blob:
            print(f"!! App kept hunks missing expected marker: {a}")
            sys.exit(1)
    return render(preamble, kept)


# ---------------- threads.ts (round 2: freezeMessage images) ----------------
THREADS_KEEP = {41, 51}


def filter_threads() -> str:
    preamble, hunks = parse_hunks(git_diff("src/lib/threads.ts"))
    kept = [h for h in hunks if h["old_start"] in THREADS_KEEP]
    if {h["old_start"] for h in hunks} - THREADS_KEEP - {15}:
        print("!! threads.ts: unexpected hunk set")
        sys.exit(1)
    check_no_forbidden([ln for h in kept for ln in pm_lines(h)], "threads.ts")
    blob = "\n".join(ln for h in kept for ln in pm_lines(h))
    if "images: undefined" not in blob:
        print("!! threads kept hunks missing images strip")
        sys.exit(1)
    return render(preamble, kept)


# ---------------- package.json (round 2: mermaid dep only) ----------------
def pkg_patch() -> str:
    head = subprocess.run(
        ["git", "show", "HEAD:package.json"], cwd=REPO, capture_output=True,
    ).stdout.decode("utf-8")
    lines = head.split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]
    anchor = '    "@assistant-ui/react-markdown": "^0.14.20",'
    idx = lines.index(anchor)
    body = (
        [" " + ln for ln in lines[: idx + 1]]
        + ['+    "mermaid": "^12.1.0",']
        + [" " + ln for ln in lines[idx + 1:]]
    )
    patch = (
        "diff --git a/package.json b/package.json\n"
        "--- a/package.json\n"
        "+++ b/package.json\n"
        f"@@ -1,{len(lines)} +1,{len(lines) + 1} @@\n" + "\n".join(body) + "\n"
    )
    added = [ln for ln in body if ln.startswith("+") and not ln.startswith("+++")]
    if len(added) != 1 or "mermaid" not in added[0]:
        print("!! package.json patch wrong")
        sys.exit(1)
    if any("dev:desktop" in ln or "acp-client" in ln for ln in added):
        print("!! package.json patch leaked teammate lines")
        sys.exit(1)
    return patch


def apply_cached(patch: str, path: str):
    # NOTE: bytes, not text — Windows text-mode pipes translate \n -> \r\n
    # and corrupt the patch.
    blob = patch.encode("utf-8")
    p = subprocess.run(
        ["git", "apply", "--cached", "--check", "-"], cwd=REPO,
        input=blob, capture_output=True,
    )
    if p.returncode != 0:
        print(f"!! --check FAILED for {path}:\n{p.stderr.decode('utf-8', 'replace')}")
        sys.exit(1)
    p = subprocess.run(
        ["git", "apply", "--cached", "-"], cwd=REPO,
        input=blob, capture_output=True,
    )
    if p.returncode != 0:
        print(f"!! apply FAILED for {path}:\n{p.stderr.decode('utf-8', 'replace')}")
        sys.exit(1)
    print(f"staged filtered patch for {path}")


def main():
    only = sys.argv[1:] or ["app", "threads", "pkg"]
    if "app" in only:
        apply_cached(filter_app(), "src/App.tsx")
    if "threads" in only:
        apply_cached(filter_threads(), "src/lib/threads.ts")
    if "pkg" in only:
        apply_cached(pkg_patch(), "package.json")
    print("OK: filtered patches staged; workdir untouched")


if __name__ == "__main__":
    main()
