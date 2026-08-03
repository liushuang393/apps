* Numeric branch: block-opening and block-closing rules must balance.
IF WS-AMOUNT > 1000
MOVE 1 TO WS-VIP-FLAG
ELSE
MOVE 0 TO WS-VIP-FLAG
END-IF.
