      * PERFORM THRU の範囲と GO TO の相互作用だけを見るケース。
      * 範囲内へ飛ぶ GO TO（実COBOLで最も多い形）と、範囲を跨がない飛びの両方を含む。
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOPPGM.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I          PIC 9(3) VALUE 0.
       01 WS-SUM        PIC 9(7) VALUE 0.
       01 WS-SKIPPED    PIC 9(1) VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM STEP-A THRU STEP-EXIT
           PERFORM VARYING WS-I FROM 1 BY 1 UNTIL WS-I > 4
               ADD WS-I TO WS-SUM
           END-PERFORM
           PERFORM 3 TIMES
               ADD 100 TO WS-SUM
           END-PERFORM
           GO TO FINISH-PARA.
       STEP-A.
           ADD 10 TO WS-SUM
           IF WS-BAIL = 1
               GO TO STEP-EXIT
           END-IF.
       STEP-B.
           ADD 20 TO WS-SUM.
       STEP-EXIT.
           EXIT.
       UNREACHED-PARA.
           MOVE 1 TO WS-SKIPPED.
       FINISH-PARA.
           DISPLAY WS-SUM
           STOP RUN.
