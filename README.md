# Smell Presenter

A throwaway prototype for discussing three ways to present code-quality findings:

| View | Answers | Groups by |
|---|---|---|
| Triage table | What's wrong, and how bad? | One row per finding, worst first |
| Remedy map | What should we do? | The fix that removes each finding |
| File heatmap | Where is the rot? | File x smell category |

All three views read the same data, share one set of filters, and open the same detail drawer.

## Run it

Browsers block `fetch` on pages opened from disk, so serve the folder:

```sh
python serve.py
```

Then open http://127.0.0.1:8000 and stop the server with Ctrl+C. The server rebuilds the project list on every page load, so a new findings file shows up after a refresh. Use `--port` to change the port and `--host 0.0.0.0` to share it on your network.

Dropping a findings JSON anywhere on the page, or picking one with the button, opens it without a server. Dropped files live in that tab only and are gone after a refresh.

## Data

```
data/
  rules.json                 rule -> category, default severity, generic fix
  projects.json              generated list for the project switcher
  <method>/<project>.json    one findings file per review
```

The folder name is the review method and becomes a group in the switcher. The file name becomes the project name.

To add a findings file, copy it into a method folder and refresh the page. Without `serve.py`, rebuild the list by hand with `python build_manifest.py`.

A findings file uses the jev linter's shape. Every field past the core set is optional.

```jsonc
{
  "project": "name",                       // optional
  "remedies": [                            // optional, project-specific fixes
    { "id": "typed-config", "title": "One typed config parser", "effort": "M" }
  ],
  "rules": { },                            // optional, overrides data/rules.json
  "filters": [
    {
      "source": "tool_name",
      "checked": ["path/a.py"],            // drives clean vs. not-checked rows in the heatmap
      "findings": [
        {
          "file": "path/a.py", "start_line": 10, "end_line": 12,
          "rule": "Magic numbers",         // looked up in rules.json
          "source": "tool_name",
          "message": "One line, `code` allowed",
          "probability": 0.7,              // null when certain or not applicable
          "related": [{ "file": "path/b.py", "start_line": 3, "end_line": 3 }],

          "severity": "high",              // optional, else the rule's default
          "detail": "Longer explanation",  // optional
          "remedy": "typed-config",        // optional, else the rule's generic fix
          "bug": true                      // optional
        }
      ]
    }
  ]
}
```

A rule missing from `rules.json` lands in an Uncategorized column with low severity.

## Categories

Duplication, Switches & nesting, Coupling, Size & cohesion, Error handling, Clarity & dead code
