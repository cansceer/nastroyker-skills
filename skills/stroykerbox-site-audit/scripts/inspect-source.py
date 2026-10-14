#!/usr/bin/env python3
"""Read-only CSS inventory and JavaScript syntax check; JavaScript is never executed."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

import tinycss2


def walk_rules(tokens, filename, context=""):
    rows, errors = [], []
    for token in tokens:
        if token.type == "error":
            errors.append({"line": token.source_line, "message": token.message})
            continue
        if token.type == "qualified-rule":
            selector = tinycss2.serialize(token.prelude).strip()
            declarations = tinycss2.parse_declaration_list(
                token.content, skip_comments=True, skip_whitespace=True
            )
            parsed = []
            for item in declarations:
                if item.type == "error":
                    errors.append({"line": item.source_line, "message": item.message, "selector": selector})
                elif item.type == "declaration":
                    parsed.append({
                        "name": item.name,
                        "value": tinycss2.serialize(item.value).strip(),
                        "important": item.important,
                        "line": item.source_line,
                    })
            rows.append({"file": filename, "line": token.source_line, "selector": selector,
                         "context": context, "declarations": parsed})
        elif token.type == "at-rule" and token.content is not None:
            name = "@" + token.lower_at_keyword + " " + tinycss2.serialize(token.prelude).strip()
            if token.lower_at_keyword in {"font-face", "page", "property"}:
                declarations = tinycss2.parse_declaration_list(
                    token.content, skip_comments=True, skip_whitespace=True
                )
                parsed = []
                for item in declarations:
                    if item.type == "error":
                        errors.append({"line": item.source_line, "message": item.message, "selector": name})
                    elif item.type == "declaration":
                        parsed.append({"name": item.name, "value": tinycss2.serialize(item.value).strip(),
                                       "important": item.important, "line": item.source_line})
                rows.append({"file": filename, "line": token.source_line, "selector": name,
                             "context": context, "declarations": parsed})
                continue
            content = tinycss2.parse_rule_list(token.content, skip_comments=True, skip_whitespace=True)
            child_rows, child_errors = walk_rules(content, filename, (context + " " + name).strip())
            rows.extend(child_rows)
            errors.extend(child_errors)
    return rows, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--files", nargs="+", required=True, help="CSS and/or JS files in cascade order")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    files, rules, errors = [], [], []
    for raw in args.files:
        path = Path(raw).resolve()
        data = path.read_bytes()
        entry = {"path": str(path), "name": path.name, "bytes": len(data),
                 "sha256": hashlib.sha256(data).hexdigest(), "kind": path.suffix.lower()}
        files.append(entry)
        if path.suffix.lower() == ".css":
            text = data.decode("utf-8-sig", errors="replace")
            parsed = tinycss2.parse_stylesheet(text, skip_comments=True, skip_whitespace=True)
            found, failures = walk_rules(parsed, path.name)
            rules.extend(found)
            errors.extend({"file": path.name, **failure} for failure in failures)
        elif path.suffix.lower() == ".js":
            result = subprocess.run(["node", "--check", str(path)], text=True, capture_output=True)
            match = re.search(r":(\d+)\s*$", result.stderr.strip())
            entry["syntax"] = "passed" if result.returncode == 0 else "failed"
            entry["syntaxErrorLine"] = int(match.group(1)) if match else None
            if result.returncode:
                errors.append({"file": path.name, "line": entry["syntaxErrorLine"],
                               "message": "node --check reported a syntax error; inspect locally."})
    widths = []
    for row in rules:
        if row["context"].startswith("@media"):
            for match in re.finditer(r"(?:min|max)-width\s*:\s*(\d+(?:\.\d+)?)\s*(px|em|rem)", row["context"], re.I):
                widths.append({"value": float(match.group(1)), "unit": match.group(2), "file": row["file"], "line": row["line"]})
    result = {"version": 1, "files": files, "rules": rules, "parseErrors": errors,
              "breakpointCandidates": widths,
              "summary": {"cssRules": len(rules),
                          "declarations": sum(len(row["declarations"]) for row in rules),
                          "parseErrors": len(errors),
                          "jsCheckedWithoutExecution": sum(f["kind"] == ".js" for f in files)}}
    target = Path(args.output).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(target), "files": len(files), **result["summary"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
