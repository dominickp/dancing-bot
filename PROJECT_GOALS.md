
## Goal
Create a "dancing bot", similar to ArrowVortex's dancing bot that plays a StepMania simfile and shows an animation of two feet stepping on the dance pad arrows.

## Terms
- stream: a continuous block of steps
- jacks: contiuous single button presses

## Types of steps
- normal: left, right, up, down
- freeze: a hold of any arrow for a set amount of time. the foot needs to press this panel continuously for the furation of the hold
- jump: two or more steps at the same time. the user needs to jump to press them at the same time
- mine: the user needs to lift their foot to avoid pressing the button while the mine passes the targets

### Description of animation appearance
The animation should show a 2D top-down view of a dance pad (e.g. Dance Dance Revolution / In The Groove) 4-panel pad. This pad has four buttons: left, up, right, and down. On the pad are two feet (appear as shoe sillouettes). When the chart says to press a button, the left or right foot animation must press on the arrow. To determine which foot needs to hit any particular arrow depends on the position of the feet from the previous state. If the arrow is up and the right foot needs to press it, the foot should raise up (indicated by getting slightly larger), then lower down as it moves from its original point to the up arrow. When it reaches the up arrow, it has to press down, which can be indicated by the up arrow lighting up for a brief moment.

### Determining which foot should be used
Feet should never return to the center panel. The feet should, in general, stay on the panel they just pressed. The exception to this is if there is a mine, in which case they can lift that foot or move it to another panel.

When determining which foot needs to hit any particular arrow depends on the position of the feet from the previous state. In general, the left foot is always used to hit the left arrow, and the right foot is always used to hit the right arrow. There is one exception to this (footswitches), but we'll touch on that later. The up and down arrows are shared by both feet determined by the initial state they are in before the new arrow is pressed. When in a stream, we should usually alternate feet between arrows presses. So if the left foot just pressed left and we next need to process an up arrow, the right foot will hit that. One exception to this are "jacks" (same arrow over and over), in which case the same foot needs to hit it over and over, lifting and pressing each time.

### Advances/uncommon patterns
- footswitch: an uncommon pattern where there are two subsequent arrows on up or down when instead of pressing up twice with the same foot, you would switch your feet. hitting up with one foot, then hitting up with the other foot. we should have an option to enable/disable footswitches on the animations
- crossover: a pattern where a user needs to turn their body to the left or right to cross their outside leg over to hit an arrow on the other side. for some styles of play, there arent crossovers or crossovers are doublestepped. but in some cases, people might do them. we should have an option to enable/disable crossing over on the animations

### Form selection
ITG players have different "form" -- which is the style of how they move their feet to hit the arrows. We can start with a basic form, but I want to eventually expand the dancing bot to support selecting from multiple.

Descriptions of form:
- straight form: the feet are mostly kept parralel and leg translation is primarily used to move the feet between buttons
- heels out: the feet point inward at the toes slightly. the heels are primarily used to hit the left and right arrows. the legs translate the feet but also rotate to allow the heels to reach the side panels
- toes out: the feet rotate out to hit the left and right arrows. for up, left, and right, its mostly just ankle rotation. to hit down, the legs translate downward to hit back with the heel.
- slanted form: the feet natually sit slanted across the center panel of the pad and you sort of have a mix of toes out on one foot and heels out on the other.

### Requirements
- Should have a UI to show the chart. All arrows should appear, with the arrow targets. The chart should scroll as the song plays and show the arrows getting hit on the targets (like stepmania autoplay). We should also have a target explosion animation when the arrow is pressed. We can look at how Stepmania/ITGMania does their animations and noteskins and copy those.
- The user can use the scroll button on their mouse to move up and down on the chart. The arrow targets should always remain in place at the top. They can play/pause the chart from any location by pressing space.
- Should have a minimap to the right of the notefield, like ArrowVortex. This allows the user to quickly jump to a different part of the song by clicking on different parts of the minimap See arrowvortex_dancingbot.png
- The user should be able to scroll with their mouse (ctrl + scroll) to slow or speed up the scrolling. Speeding up stretches out the arrows and causes them to scroll faster, and slowing them causes them to appear as more condensed. The actual steps stay the same, just the appearance changes. 
- The notefield should show measure counters.
- The notes should have the correct quantization, indicated by colors (we can reference StepMania for this). But 8th notes and 16th notes should be different colors, for example.
- We should allow imported of different noteskins, see how stepmania handles this, should be compatible with the same noteskin files.
- Should play the audio file for the song at the correct time, just like stepmania does.

## Stepmania/itgmania reference
- ITGMania is a modern Stepmania fork
  - https://github.com/itgmania/itgmaniasimply
- Simply Love is a modern stepmania theme packaged with ITGMania
  - https://github.com/Simply-Love/Simply-Love-SM5
- I have local installations if you want to look at any of the files quickly
  - C:\Games\ITGmania
  - C:\Games\ITGmania\Themes\Simply Love
