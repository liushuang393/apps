package jp.co.softroad.legacy.action;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import jp.co.softroad.legacy.form.SearchForm;
import org.apache.struts.action.Action;
import org.apache.struts.action.ActionForm;
import org.apache.struts.action.ActionForward;
import org.apache.struts.action.ActionMapping;

public class SearchAction extends Action {

    public ActionForward execute(ActionMapping mapping, ActionForm form,
            HttpServletRequest request, HttpServletResponse response) throws Exception {
        SearchForm searchForm = (SearchForm) form;
        request.setAttribute("keyword", searchForm.getKeyword());
        request.setAttribute("rows", searchForm.getRows());
        return mapping.findForward("success");
    }
}
