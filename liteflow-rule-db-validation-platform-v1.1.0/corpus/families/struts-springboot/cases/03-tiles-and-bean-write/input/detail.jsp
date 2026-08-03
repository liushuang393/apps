<%@ page contentType="text/html; charset=UTF-8" %>
<%@ taglib uri="http://struts.apache.org/tags-html" prefix="html" %>
<%@ taglib uri="http://struts.apache.org/tags-bean" prefix="bean" %>
<%@ taglib uri="http://struts.apache.org/tags-tiles" prefix="tiles" %>
<tiles:insert definition="site.layout" flush="true">
<tiles:put name="title" value="明細" />
<tiles:put name="body" value="/detail-body.jsp" />
</tiles:insert>
<bean:write name="detailForm" property="id" filter="true"/>
<bean:message key="label.detail.id"/>
<html:errors/>
