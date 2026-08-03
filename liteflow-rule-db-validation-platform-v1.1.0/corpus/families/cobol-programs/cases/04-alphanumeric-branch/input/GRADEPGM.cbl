      * 英数字比較の分岐。compilable-v1 ではここが穴で、
      * 「コンパイルは通るのに実行時に壊れる」負例になっていた。
      * cobol-programs-v1 では専用ルールで対応しているので PASS するのが正しい。
       IDENTIFICATION DIVISION.
       PROGRAM-ID. GRADEPGM.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-STATUS     PIC X(4) VALUE SPACES.
       01 WS-FEE        PIC 9(5) VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           IF WS-STATUS = 'VIP'
               MOVE 0 TO WS-FEE
           ELSE
               MOVE 500 TO WS-FEE
           END-IF
           IF WS-STATUS NOT = 'VIP'
               ADD 50 TO WS-FEE
           END-IF
           DISPLAY WS-FEE
           STOP RUN.
