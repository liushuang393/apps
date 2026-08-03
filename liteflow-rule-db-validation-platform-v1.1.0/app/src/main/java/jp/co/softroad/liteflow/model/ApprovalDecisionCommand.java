package jp.co.softroad.liteflow.model;

/** 承認・却下の判断メモ。 */
public class ApprovalDecisionCommand {
    private String note;

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }
}
