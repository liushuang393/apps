      * 従プログラムその1。税額を計算して呼び出し元へ返す。
      * LINKAGE の名前は呼び出し元と違う。位置で束縛されることの確認になる。
       IDENTIFICATION DIVISION.
       PROGRAM-ID. SUBTAX.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INDEX      PIC 9(3) VALUE 99.
       LINKAGE SECTION.
       01 LK-AMOUNT     PIC 9(7).
       01 LK-RATE       PIC 9(3).
       01 LK-TAX        PIC 9(7).
       PROCEDURE DIVISION USING LK-AMOUNT LK-RATE LK-TAX.
       TAX-PARA.
           COMPUTE LK-TAX = LK-AMOUNT * LK-RATE
           DIVIDE 100 INTO LK-TAX
           GOBACK.
       TAX-NEVER-PARA.
           MOVE 999999 TO LK-TAX.
