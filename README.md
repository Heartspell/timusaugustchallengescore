# TIMUS august 2026 challenge

Static ICPC-style scoreboard for a Timus challenge.

## Edit participants and tasks

- `authors.txt`: one Timus author id per line. Add text after the id only when you want a manual alias; otherwise the site takes the name from Timus.
- `tasks.txt`: one day per block. The third task in each block is treated as the hard task.

## Update data

The site parses Timus in the browser on load and falls back to `data/scoreboard.json`.
GitHub Actions updates that JSON every 5 minutes.

Manual update:

```sh
node scripts/update-scoreboard.mjs
```
