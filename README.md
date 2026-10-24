# time-left

A Claude Code mod that adds a **Time left** pane beside the chat. It shows each running
subagent, long tool call and the current turn with elapsed time, an estimate of the time
remaining and a progress bar, plus the last few finished items and how long they took.

Estimates are learned: every finished run is recorded per kind (for example `agent:Explore`
or `tool:Bash`), and the estimate is the median of the last 20 runs. Until a kind has a run
of its own, a built-in default is used and the row is marked `(guess)`. Runs past their
estimate show `over by …`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install time-left --marketplace DJsluxx/claude-time-left
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install time-left --marketplace DJsluxx/claude-time-left
```

## Use

The pane opens on its own once a window is attached; `/time-left` opens it again.

## License

MIT
