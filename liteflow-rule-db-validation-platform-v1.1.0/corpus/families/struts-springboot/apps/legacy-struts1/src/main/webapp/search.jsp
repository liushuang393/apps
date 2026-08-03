<%@ page contentType="text/html; charset=UTF-8" %>
<%@ taglib uri="http://struts.apache.org/tags-html" prefix="html" %>
<%@ taglib uri="http://struts.apache.org/tags-logic" prefix="logic" %>
<html>
<head>
<title>検索一覧</title>
</head>
<body>
<h1>検索一覧</h1>
<html:form action="/search">
<html:text property="keyword"/>
<html:text property="status"/>
<html:submit value="検索"/>
</html:form>
<logic:iterate id="row" name="rows">
<html:link page="/detail">明細</html:link>
</logic:iterate>
</body>
</html>
