# TIMUS august 2026 challenge

Static ICPC-style scoreboard for a Timus challenge.

## Edit participants and tasks

- `authors.txt`: one Timus author id per line. Add text after the id only when you want a manual alias; otherwise the site takes the name from Timus.
- `tasks.txt`: one day per block. The third task in each block is treated as the hard task.

## Update data

The site only reads `data/scoreboard.json`.
GitHub Actions parses Timus and updates that JSON every 5 minutes.

External update trigger:

```sh
curl -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/Heartspell/timusaugustchallengescore/dispatches \
  -d '{"event_type":"update-scoreboard"}'
```

Heroku pinger:

```sh
heroku config:set GITHUB_TOKEN=your_token_here
heroku config:set PING_INTERVAL_MS=300000
git push heroku 13-disable-live-update:main
```

Manual update:

```sh
node scripts/update-scoreboard.mjs
```
