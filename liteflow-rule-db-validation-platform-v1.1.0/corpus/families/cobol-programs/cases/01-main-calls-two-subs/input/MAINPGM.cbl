      * 主プログラム。2本の従プログラムを CALL する。
      * 分岐・ループ・GO TO・CALL を1本にまとめた代表ケース。
       IDENTIFICATION DIVISION.
       PROGRAM-ID. MAINPGM.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-COUNT      PIC 9(3) VALUE 0.
       01 WS-UNIT       PIC 9(5) VALUE 0.
       01 WS-RATE       PIC 9(3) VALUE 0.
       01 WS-INDEX      PIC 9(3) VALUE 0.
       01 WS-SUBTOTAL   PIC 9(7) VALUE 0.
       01 WS-TAX        PIC 9(7) VALUE 0.
       01 WS-TOTAL      PIC 9(7) VALUE 0.
       01 WS-RANK       PIC 9(1) VALUE 0.
       01 WS-LABEL      PIC X(8) VALUE SPACES.
       PROCEDURE DIVISION.
       MAIN-PARA.
           MOVE 0 TO WS-SUBTOTAL
           MOVE 1 TO WS-INDEX
           PERFORM ACCUM-PARA UNTIL WS-INDEX > WS-COUNT
           IF WS-SUBTOTAL = 0
               MOVE 'EMPTY' TO WS-LABEL
               GO TO REPORT-PARA
           END-IF
           CALL 'SUBTAX' USING WS-SUBTOTAL WS-RATE WS-TAX
           COMPUTE WS-TOTAL = WS-SUBTOTAL + WS-TAX
           PERFORM RANK-PARA
           CALL 'SUBLABEL' USING WS-RANK WS-LABEL
           GO TO REPORT-PARA.
       ACCUM-PARA.
           ADD WS-UNIT TO WS-SUBTOTAL
           ADD 1 TO WS-INDEX.
       RANK-PARA.
           EVALUATE WS-TOTAL
           WHEN 0
               MOVE 0 TO WS-RANK
           WHEN OTHER
               IF WS-TOTAL > 1000
                   MOVE 3 TO WS-RANK
               ELSE
                   MOVE 1 TO WS-RANK
               END-IF
           END-EVALUATE.
       SKIPPED-PARA.
           MOVE 'NEVER' TO WS-LABEL.
       REPORT-PARA.
           DISPLAY WS-LABEL
           STOP RUN.
