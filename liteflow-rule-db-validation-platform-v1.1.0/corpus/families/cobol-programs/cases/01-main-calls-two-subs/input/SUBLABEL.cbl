      * 従プログラムその2。順位から表示ラベルを決める。
      * WS-INDEX という名前を主プログラムと共有しているが、
      * 呼び出し元の値を壊してはならない（WORKING-STORAGE の隔離）。
       IDENTIFICATION DIVISION.
       PROGRAM-ID. SUBLABEL.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INDEX      PIC 9(3) VALUE 777.
       LINKAGE SECTION.
       01 LK-RANK       PIC 9(1).
       01 LK-TEXT       PIC X(8).
       PROCEDURE DIVISION USING LK-RANK LK-TEXT.
       LABEL-PARA.
           EVALUATE LK-RANK
           WHEN 3
               MOVE 'GOLD' TO LK-TEXT
           WHEN 1
               MOVE 'SILVER' TO LK-TEXT
           WHEN OTHER
               MOVE 'NONE' TO LK-TEXT
           END-EVALUATE
           GOBACK.
