<%@ page contentType="text/html; charset=UTF-8" %>
<%@ taglib uri="http://struts.apache.org/tags-html" prefix="html" %>
<html>
<head>
<title>ログイン</title>
</head>
<body>
<h1>ログイン</h1>
<html:form action="/login">
<html:text property="userId"/>
<html:password property="password"/>
<html:submit value="ログイン"/>
</html:form>
</body>
</html>
