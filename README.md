# Self-Raising Diagrams
A text file is a static medium. Source code is self-raising text: the static text raises itself into a dynamic run-time environment (usually unvisualised).

A vector graphics diagram is a static medium. A self-raising diagram is a generalisation of source code: it raises itself into a dynamic run-time environment, this time with an obvious visualisation.

We take advantage of *existing* drawing tools to draw the diagrams, just as we take advantage of *existing* text editors to write code (even to write our own custom syntaxes). This sidesteps the classic trap of having to implement your own (crappy) custom drawing software just to get the precise notational semantics that you want. Imagine if you always had to build your own text editor just to use your domain-specific syntax!

Outsource the drawing to drawing experts, and encode dynamic behaviour in the diagram somehow (just like source code). The shapes get drawn and placed in software *optimised* for drawing; all the rest is performed by multiple compilation passes from diagram to diagram, or interpretation of the diagram in a run-time environment. This is the part that is unique to us as notational engineers - *not* coding event handlers for line rubberbanding for the umpteenth time.

It is futile to expect to reinvent Adobe Illustrator in Squeak Smalltalk in order to draw beautiful GUIs. Just use Adobe Illustrator itself to make a beautiful schematic, with embedded instructions for responding to change, and load this into your favourite environment as if it were source code.

In this project, I draw in [Mathcha.io](https://www.mathcha.io/editor) and output to (horrible) SVG. The SVG shall raise itself into a dynamic web app in the web browser.

# Object vs Meta Graphics
Some parts of the diagram are object-level: they're part of the intended output. Other parts (perhaps in a designated meta-colour, like blue) are instructions to the next transformation pass to alter the diagram in some way (add stuff, remove stuff, etc). Sorta like macros.

# Current instructions
Currently, we recognise a simple visual notation of boxes, arrows, and text labels. Arrows are labelled by the closest text element. A text element not attached to an arrow may name a nearby box, if it is close enough. Each box means a JS object, and each arrow means a property, with the "obvious" semantics on that. The JS object will have its `name` property set to the box's name if it has one.

![Begin with a de-spatialising pass, ending up with DOM id's set and visual elements added to confirm correctness. Finish with a JS object graph.](boxes-arrows-labels-overview.svg)

If providing your own SVG file, you need to insert the following into it, below the top svg element:

```html
<script href="./misc.js"></script>
```

## Example 1
Open `diagram.svg` in Firefox. In the Ctrl-Shift-I console, call `main()` and see if `objs` encodes the correct names/relationships.

## Example 2
Open `id-simple.svg`. Run `main()`. Verify `objs`.

![Demo of a more complex object structure.](demo-id.png)

