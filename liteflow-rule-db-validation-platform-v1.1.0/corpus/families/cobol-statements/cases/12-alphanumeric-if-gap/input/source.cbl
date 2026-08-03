* The if-compare rule matches this, but generates a NUMERIC comparison.
* Compilation succeeds and the code is still wrong - only the behavioural
* test can catch it. That is the whole point of this case.
MOVE 'ABC' TO WS-NAME.
IF WS-NAME = 'ABC'
MOVE 1 TO WS-MATCH
ELSE
MOVE 0 TO WS-MATCH
END-IF.
