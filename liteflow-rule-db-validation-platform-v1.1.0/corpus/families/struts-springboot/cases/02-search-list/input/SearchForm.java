package jp.co.softroad.legacy.form;

import org.apache.struts.action.ActionForm;

public class SearchForm extends ActionForm {

    private String keyword;
    private String status;
    private String rows;

    public String getKeyword() {
        return keyword;
    }

    public void setKeyword(String keyword) {
        this.keyword = keyword;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getRows() {
        return rows;
    }

    public void setRows(String rows) {
        this.rows = rows;
    }
}
