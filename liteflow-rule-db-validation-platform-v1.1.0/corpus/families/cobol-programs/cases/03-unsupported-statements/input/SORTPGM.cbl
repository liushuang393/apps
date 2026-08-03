      * 負例。ルール表が扱えない文を含む。
      * SORT / STRING / INSPECT / SEARCH は cobol-programs-v1 に無い。
      * 未カバー率でゲートが落ちるのが正しい。落ちなくなったらゲートの退行。
       IDENTIFICATION DIVISION.
       PROGRAM-ID. SORTPGM.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-NAME       PIC X(20) VALUE SPACES.
       01 WS-COUNT      PIC 9(3) VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           MOVE 0 TO WS-COUNT
           SORT SORT-FILE ON ASCENDING KEY SORT-KEY
           STRING WS-FIRST DELIMITED BY SPACE INTO WS-NAME
           INSPECT WS-NAME TALLYING WS-COUNT FOR ALL 'A'
           SEARCH ALL WS-TABLE AT END MOVE 0 TO WS-COUNT
           STOP RUN.
