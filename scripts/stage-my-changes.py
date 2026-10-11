"""Stage only my hunks (assistant-ui chat migration) from mixed dirty files.

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


def check_no_forbidden(kept_plus_minus, where: str):
    for ln in kept_plus_minus:
        if ln.startswith(("+", "-")) and not ln.startswith(("+++", "---")):
            if any(m in ln for m in FORBIDDEN):
                print(f"!! forbidden marker in {where}: {ln}")
                sys.exit(1)


def surgery_app_1(h):  # imports: drop teammate imports
    h["lines"] = [ln for ln in h["lines"]
                  if not (ln.startswith("+") and ("TitleBar" in ln or "useThemeStore" in ln))]


def surgery_app_312(h):  # ensureSession: revert teammate edits to context
    out = []
    for ln in h["lines"]:
        body = ln[1:] if ln[:1] in "+-" else ln
        if ln.startswith("+") and ("autoServers" in ln or "Auto-created sessions inherit" in ln):
            continue
        if ln.startswith("+") and "if (!force && (st.isStreaming || st.busy)) return null;" in ln:
            continue
        if ln.startswith("-") and "if (st.isStreaming || st.busy) return null;" in ln:
            out.append(" " + body)
            continue
        if ln.startswith("-") and body.strip().startswith("const res: any = await sessionNew"):
            out.append(" " + body)
            continue
        if ln.startswith("-") and "bindThreadSession(useStudioStore.getState().sessionId, reqCwd);" in ln:
            out.append(" " + body)
            continue
        out.append(ln)
    h["lines"] = out


APP_KEEP_JSX = (
    "<PermissionDialog pending=",
    "!s.sessionId || p.sessionId === s.sessionId",
    "s.sessionId && p.sessionId !== s.sessionId",
    "matchPermToToolCalls",
    "已在工具卡",
    "imperative",
    "return true;",
    "onRespond={handlePermRespond}",
)


def surgery_app_1029(h):  # mega layout hunk: diseased context; drop entirely,
    # the PermissionDialog pair is re-based onto HEAD by head_perm_hunk().
    h["lines"] = []


PERM_PLUS = [
    "        <PermissionDialog pending={s.pendingPerms.filter((p) => {",
    "          if (s.sessionId && p.sessionId !== s.sessionId) return false;",
    "          // 已在工具卡内联展示的不再进全局弹窗 (匹配器见 acp-assistant.ts)。",
    "          // 用 getState  imperative 读取 messages，避免 shell 订阅流式热路径。",
    "          if (matchPermToToolCalls(p, useStudioStore.getState().messages, s.sessionId)) return false;",
    "          return true;",
    "        })} onRespond={handlePermRespond} respondingId={s.respondingId} />",
]


def head_perm_hunk():
    """PermissionDialog filter change, based on HEAD context (1-based)."""
    blob = subprocess.run(
        ["git", "show", "HEAD:src/App.tsx"], cwd=REPO, capture_output=True,
    ).stdout.decode("utf-8")
    if blob.endswith("\n"):
        blob = blob[:-1]
    lines = blob.split("\n")
    idx = next(i for i, ln in enumerate(lines) if "PermissionDialog pending=" in ln)
    if "matchPermToToolCalls" in lines[idx]:
        print("!! HEAD already contains the new filter; abort")
        sys.exit(1)
    body = (
        [" " + lines[idx - 3], " " + lines[idx - 2], " " + lines[idx - 1]]
        + ["-" + lines[idx]]
        + ["+" + ln for ln in PERM_PLUS]
        + [" " + lines[idx + 1], " " + lines[idx + 2], " " + lines[idx + 3]]
    )
    return {"old_start": idx - 2, "tail": " export default function App() {", "lines": body}


def surgery_app_1117(h):  # composer swap: drop teammate wrapper close
    drops = [ln for ln in h["lines"] if ln == "+    </div>"]
    if len(drops) != 1:
        print(f"!! hunk 1117: expected 1 wrapper-close drop, got {len(drops)}")
        sys.exit(1)
    h["lines"] = [ln for ln in h["lines"] if ln != "+    </div>"]


APP_RULES = {
    1: surgery_app_1, 72: "keep", 89: "keep", 136: "keep", 191: "drop",
    212: "keep", 233: "keep", 312: surgery_app_312, 331: "keep", 352: "keep",
    375: "drop", 393: "keep", 401: "keep", 443: "drop", 628: "drop", 713: "drop", 726: "drop",
    754: "drop", 881: "keep", 892: "drop", 903: "keep", 937: "keep",
    965: "keep", 998: "keep", 1029: surgery_app_1029, 1117: surgery_app_1117,
}

STORE_KEEP = {25, 50, 99, 149, 281, 485}


def filter_app() -> str:
    preamble, hunks = parse_hunks(git_diff("src/App.tsx"))
    kept = []
    for h in hunks:
        rule = APP_RULES.get(h["old_start"])
        if rule is None:
            print(f"!! App.tsx: no rule for hunk @@ -{h['old_start']}")
            sys.exit(1)
        if rule == "drop":
            continue
        if callable(rule):
            rule(h)
        if not [ln for ln in h["lines"] if ln != ""]:
            continue  # surgery emptied it (1029)
        kept.append(h)
    kept.append(head_perm_hunk())
    kept.sort(key=lambda h: h["old_start"])
    check_no_forbidden([ln for h in kept for ln in h["lines"]], "App.tsx")
    return render(preamble, kept)


def filter_store() -> str:
    preamble, hunks = parse_hunks(git_diff("src/stores/useStudioStore.ts"))
    kept = [h for h in hunks if h["old_start"] in STORE_KEEP]
    if len(kept) != len(STORE_KEEP):
        print("!! store: kept hunk set mismatch")
        sys.exit(1)
    check_no_forbidden([ln for h in kept for ln in h["lines"]], "useStudioStore.ts")
    return render(preamble, kept)


def pkg_patch() -> str:
    head = subprocess.run(
        ["git", "show", "HEAD:package.json"], cwd=REPO, capture_output=True,
        text=True, encoding="utf-8",
    ).stdout
    if not head.endswith("\n"):
        print("!! package.json has no trailing newline; abort")
        sys.exit(1)
    lines = head.split("\n")[:-1]
    anchor = '    "@agentclientprotocol/sdk": "^1.0.0",'
    idx = lines.index(anchor)
    body = (
        [" " + ln for ln in lines[: idx + 1]]
        + ['+    "@assistant-ui/react": "^0.15.27",', '+    "@assistant-ui/react-markdown": "^0.14.20",']
        + [" " + ln for ln in lines[idx + 1:]]
    )
    patch = (
        "diff --git a/package.json b/package.json\n"
        "--- a/package.json\n"
        "+++ b/package.json\n"
        f"@@ -1,{len(lines)} +1,{len(lines) + 2} @@\n" + "\n".join(body) + "\n"
    )
    added = [ln for ln in body if ln.startswith("+") and not ln.startswith("+++")]
    if any("dev:desktop" in ln or "acp-client" in ln for ln in added):
        print("!! package.json patch leaked teammate lines")
        sys.exit(1)
    return patch


def apply_cached(patch: str, path: str):
    # NOTE: bytes, not text — Windows text-mode pipes translate \n -> \r\n
    # and corrupt the patch (see: "patch failed" on valid hunks).
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
    only = sys.argv[1:] or ["store", "app", "pkg"]
    if "store" in only:
        apply_cached(filter_store(), "src/stores/useStudioStore.ts")
    if "app" in only:
        apply_cached(filter_app(), "src/App.tsx")
    if "pkg" in only:
        apply_cached(pkg_patch(), "package.json")
    print("OK: filtered patches staged; workdir untouched")


if __name__ == "__main__":
    main()
