Port @SURFACE in @REPO to match @PROTOTYPE variant @VARIANT, one-to-one.

Read the whole prototype first — not just the part that looks like the gap — and
list every renderable unit in it: layout regions, components, states, visual
variants, and every user-visible string. Then go down that list against the app
and mark each one as already matching, needs work, or missing. Show me the list
before you change anything.

Then build what's missing. Match structure and copy exactly, not the general
vibe. Design tokens only — no arbitrary values, add a token if one is missing.
Read before you edit. Don't delete anything without asking.

Finish with lint, build and test actually run, the real output pasted, and
anything you couldn't match and why.