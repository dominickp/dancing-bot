# dancing-bot

A dancing bot, based off of ArrowVortex's dancing bot but with support for different "forms".

The app ships with bundled example simfiles, so users can immediately try the preview without importing their own song folder first. But you can also load your own chart.

## Controls
Controls are based on ArrowVortex:
- Mousewheel scroll to navigate through the chart
- CTRL + mousewheel scroll zooms you in to the chart (spaces out the notes)
- Click to drag the notefield to move it side to side

## TODO / Known issues
- Adjust dancing bot timing
- Add assist tick sound
- Add rate mod (speed/slow down song/animation)
- Footswitches not yet supported
- Crossing over and turning not yet supported
- Brackets not yet supported
- Hands not yet supported

For some of the above reasons, a lot of tech charts don't work well right now. What does work well are stamina songs/streams.

## Run
```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

