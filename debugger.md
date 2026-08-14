# Debugger protocol

The `harbour-dbg` debug adapter talks to the running program over a plain
TCP socket. Messages sent **from the debugger to the program** look like
`COMMAND:PARAM1:PARAM2:PARAM3...\r\n`. Messages sent **from the program back
to the debugger** look like `COMMAND\r\nPARAM1\r\nPARAM2\r\n`.

## GO →
Tells the program to resume execution.

## NEXT →
Tells the program to execute the next statement (stepping over calls).

## STEP →
Tells the program to execute the next statement at the same call level
(stepping into calls).

## EXIT →
Tells the program to exit the current method/function.

## PAUSE →
Tells the program to break at the next statement **compiled with debug
symbols**.

## STOP ←
The program has stopped. Followed by a short textual reason, e.g. `"Break"`
(hit a breakpoint) or `"Pause"` (a `PAUSE` command was processed), etc.

## ERROR ←
The program has stopped because of an error.

## INERROR →
Asks whether the program is currently in an error state; the program
replies `T`/`F`. ***Currently unused.***

## BREAKPOINT →
Announces a breakpoint to add or remove. The second line has its parameters
separated by `:`:
- `+`/`-` — add or remove.
- the file name.
- the line number.
- optionally `?` followed by (again `:`-separated) a Harbour expression to
  evaluate, with `:` replaced by `;` — the breakpoint only triggers if this
  evaluates to true.
- optionally `C` followed by a count — the breakpoint only triggers after
  being hit that many times.
- optionally `L` followed by a string where the parts between `{}` are
  evaluated (***format subject to change***).

## LOG ←
Requests printing a debug string, which follows the `LOG:` prefix.

## LOCALS, PUBLICS, PRIVATES, PRIVATE_CALLEE, STATICS →
Requests the list of variables in the given scope. The second line has its
parameters separated by `:`:
- the stack level.
- the index of the first item to return (1-based).
- how many items to return, `0` for all of them.

The program replies with one message per variable, each starting with the
same command, followed by (`:`-separated):
- the 3-letter prefix used to request this variable's children.
- the stack level.
- this variable's numeric id.
- this variable's id name.
- its name.

## EXPRESSION →
Requests evaluation of an expression. The second line has its parameters
separated by `:`:
- the stack level.
- the expression, with `:` replaced by `;`.

The program replies with a message starting with **EXPRESSION**, followed
by (`:`-separated):
- the stack level.
- the result type — one of `U`, `N`, `C`, `L`, `A`, `H`, `O`, etc.
- the result to display, for `N`/`C`/`L`; or the number of children, for
  `A`/`H`/`O`.
