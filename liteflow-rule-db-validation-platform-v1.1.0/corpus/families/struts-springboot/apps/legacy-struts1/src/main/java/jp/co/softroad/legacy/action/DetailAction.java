package jp.co.softroad.legacy.action;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import jp.co.softroad.legacy.form.DetailForm;
import org.apache.struts.action.Action;
import org.apache.struts.action.ActionForm;
import org.apache.struts.action.ActionForward;
import org.apache.struts.action.ActionMapping;
import org.apache.struts.action.ActionErrors;
import org.apache.struts.action.ActionMessage;

public class DetailAction extends Action {

    public ActionForward execute(ActionMapping mapping, ActionForm form,
            HttpServletRequest request, HttpServletResponse response) throws Exception {
        DetailForm detailForm = (DetailForm) form;
        ActionErrors errors = new ActionErrors();
        errors.add("id", new ActionMessage("error.detail.notfound"));
        saveErrors(request, errors);
        request.getSession().setAttribute("detail", detailForm.getId());
        return mapping.findForward("success");
    }
}
