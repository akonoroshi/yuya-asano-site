# Shino's chat animation

- Keep Shino's natural seated motion visible during idle and between chat turns, including subtle breathing, head movement, and blinks. Preserve smooth transitions through replies, listening cues, gestures, and the return to desk rest. Respect the visitor's reduced-motion preference.
- Keep idle motion enabled in `src/components/CharacterMount.ts`. When tuning backchannels, listening, or gesture timing, adjust the cue or transition that needs changing so Shino's baseline motion continues.
- Use the shared `@tonari/characters` renderer and its matching, prevalidated motion assets. Changes to natural motion must reuse prepared collision clearance during playback without recomputing clash detection. Validate new or changed motion against the seated model and furniture when preparing the assets.
- For mount or dependency changes that affect Shino's motion, check several breathing cycles before and after a reply and a listening cue with reduced motion off. Verify that the prepared path plays without fresh clash detection.
